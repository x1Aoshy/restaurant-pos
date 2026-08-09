# Entorno de desarrollo. NO es la imagen de producción: lo que se distribuye es
# un instalador de Windows, y una aplicación de escritorio no se sirve desde un
# contenedor. Esto existe para que alguien pueda compilar y pasar las pruebas
# sin instalar Rust, WebKit y Node a mano.

# Node 22 y no una versión anterior: las comprobaciones ejecutan el esquema
# contra `node:sqlite`, que no existe hasta la 22.5. Con Node 20 la imagen
# construye bien y `npm run verify` falla con un error que no se parece en nada
# a la causa.
FROM node:22-bookworm

# Dependencias de Tauri v2 en Debian. `pkg-config` no es opcional aunque no se
# nombre en ningún error legible: sin él, `cargo build` no encuentra WebKit y se
# queja de otra cosa.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        curl \
        wget \
        file \
        libssl-dev \
        libgtk-3-dev \
        libwebkit2gtk-4.1-dev \
        libjavascriptcoregtk-4.1-dev \
        libsoup-3.0-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxdo-dev \
    && rm -rf /var/lib/apt/lists/*

# Rust en una ruta compartida por todo el sistema, no en el home: así el volumen
# de caché sirve igual sea cual sea el usuario que ejecute el contenedor.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path \
    && chmod -R a+w $RUSTUP_HOME $CARGO_HOME

WORKDIR /app

# Sin CMD: la imagen no arranca nada sola. Se entra con `docker compose run` y
# se ejecuta lo que haga falta.
