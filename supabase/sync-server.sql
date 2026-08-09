-- =============================================================================
-- Servidor de sincronización — ejecutar una vez en el editor SQL de Supabase.
--
-- El servidor NO replica el esquema del POS. Solo guarda cambios en orden y los
-- devuelve. Toda la lógica del negocio —totales, existencias, estados— sigue
-- viviendo en cada terminal, que la recalcula de las filas de origen.
--
-- La ventaja de que sea un registro y no una copia de las tablas: cuando el
-- esquema del POS cambie, el servidor no se entera y no hay migración que
-- coordinar entre equipos.
--
-- ## Acceso
--
-- No se usa Supabase Auth. Cada local tiene una clave secreta y los terminales
-- llaman a dos funciones que la comprueban. El rol anónimo NO puede tocar
-- ninguna tabla: solo ejecutar esas dos funciones. Así la clave pública de
-- Supabase, que va dentro del binario y es pública por diseño, no sirve de nada
-- por sí sola.
--
-- ## Sin pgcrypto
--
-- No hace falta ninguna extensión: `sha256` y `gen_random_uuid` son parte de
-- Postgres. Se evita así el problema de que en Supabase pgcrypto vive en el
-- esquema `extensions` y no en `public`, que es donde lo buscaría una función
-- con `search_path` acotado — y acotarlo no es opcional en algo que se ejecuta
-- con permisos elevados.
--
-- Y bcrypt tampoco pinta nada aquí: encarecer el cálculo protege contraseñas
-- que las personas eligen y se repiten. Esta clave la genera la máquina con 240
-- bits de azar, y contra eso no hay diccionario que valga. Un SHA-256 basta.
-- =============================================================================


create table if not exists public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Se guarda el hash, no la clave. Si alguien lee la tabla no obtiene acceso.
  token_hash  text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.changes (
  seq         bigserial primary key,
  venue_id    uuid not null references public.venues(id) on delete cascade,
  -- Qué equipo lo mandó: sirve para no devolverle sus propios cambios.
  device_id   text not null,
  table_name  text not null,
  row_id      text not null,
  op          text not null check (op in ('upsert','delete')),
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists changes_venue_seq_idx
  on public.changes (venue_id, seq);

-- Nadie llega a las tablas directamente.
alter table public.venues  enable row level security;
alter table public.changes enable row level security;
revoke all on public.venues  from anon, authenticated;
revoke all on public.changes from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Alta de un local. Se ejecuta A MANO desde el editor SQL, no desde la app:
-- devuelve la clave en claro una sola vez y ya no se puede recuperar.
--
--   select * from public.create_venue('Mi restaurante');
-- -----------------------------------------------------------------------------
create or replace function public.create_venue(p_name text)
returns table (venue_id uuid, token text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  -- Dos UUID aleatorios encadenados: 64 caracteres y unos 240 bits de azar.
  v_token text := replace(gen_random_uuid()::text, '-', '')
               || replace(gen_random_uuid()::text, '-', '');
  v_id    uuid;
begin
  insert into public.venues (name, token_hash)
  values (p_name, encode(sha256(v_token::bytea), 'hex'))
  returning id into v_id;

  return query select v_id, v_token;
end;
$$;

revoke execute on function public.create_venue(text) from public;

-- -----------------------------------------------------------------------------
-- Comprueba la clave y devuelve el local.
-- -----------------------------------------------------------------------------
create or replace function public.venue_of(p_token text)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select id from public.venues
   where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
   limit 1;
$$;

revoke execute on function public.venue_of(text) from public;

-- -----------------------------------------------------------------------------
-- Subir. Recibe el buzón de un terminal y devuelve cuántos entraron.
--
-- `p_changes` es un array JSON de {table_name, row_id, op, payload}.
-- -----------------------------------------------------------------------------
create or replace function public.sync_push(
  p_token   text,
  p_device  text,
  p_changes jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_venue uuid := public.venue_of(p_token);
  v_last  bigint;
begin
  if v_venue is null then
    raise exception 'clave de local no válida' using errcode = '28000';
  end if;

  insert into public.changes (venue_id, device_id, table_name, row_id, op, payload)
  select v_venue, p_device,
         c->>'table_name', c->>'row_id', c->>'op', c->'payload'
    from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) as c;

  select coalesce(max(seq), 0) into v_last
    from public.changes where venue_id = v_venue;

  return v_last;
end;
$$;

revoke execute on function public.sync_push(text, text, jsonb) from public;
grant  execute on function public.sync_push(text, text, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- Bajar. Devuelve lo que haya después de `p_after`, sin lo que mandó este mismo
-- equipo —ya lo tiene— y en orden estricto de llegada.
--
-- El orden es lo que sustituye a comparar relojes: dos PC de un local llevan la
-- hora que llevan, y una diferencia de dos minutos bastaría para que un cambio
-- viejo pisara al bueno.
-- -----------------------------------------------------------------------------
create or replace function public.sync_pull(
  p_token  text,
  p_device text,
  p_after  bigint,
  p_limit  int default 500
)
returns table (
  seq        bigint,
  table_name text,
  row_id     text,
  op         text,
  payload    jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_venue uuid := public.venue_of(p_token);
begin
  if v_venue is null then
    raise exception 'clave de local no válida' using errcode = '28000';
  end if;

  return query
    select c.seq, c.table_name, c.row_id, c.op, c.payload
      from public.changes c
     where c.venue_id = v_venue
       and c.seq > coalesce(p_after, 0)
       and c.device_id <> p_device
     order by c.seq
     limit least(coalesce(p_limit, 500), 2000);
end;
$$;

revoke execute on function public.sync_pull(text, text, bigint, int) from public;
grant  execute on function public.sync_pull(text, text, bigint, int) to anon;

-- -----------------------------------------------------------------------------
-- Limpieza. El registro crece sin parar; una vez que todos los terminales han
-- pasado de cierto número, lo anterior ya no le sirve a nadie.
--
-- Conviene programarla con pg_cron, o ejecutarla de vez en cuando a mano.
-- Noventa días es margen de sobra para un equipo que estuvo apagado.
-- -----------------------------------------------------------------------------
create or replace function public.sync_prune(p_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted bigint;
begin
  delete from public.changes
   where created_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.sync_prune(int) from public;
