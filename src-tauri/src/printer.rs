//! Impresión térmica por ESC/POS.
//!
//! ## Qué cubre
//!
//! Red, puerto 9100. Es lo que hablan por defecto las Epson TM-T20 y TM-T88,
//! las XPrinter XP-58 y XP-80, las 3nStar y prácticamente todas las clónicas
//! que se venden aquí. Una impresora de red se comparte entre terminales y se
//! cambia de sitio sin tocar ningún ordenador; una USB queda atada al equipo
//! que la tiene enchufada, y en un salón eso se nota el primer día.
//!
//! USB no está. Necesita `rusb` y un controlador WinUSB instalado a mano en
//! cada máquina, y se rompe cada vez que Windows decide reasignar el puerto.
//! El esquema ya lo contempla (`printers.connection`), así que añadirlo después
//! no obliga a migrar nada.
//!
//! ## Lo que NO hace
//!
//! Imprimir imágenes ni códigos de barras. Un ticket de restaurante no los
//! necesita, y el logotipo en mapa de bits multiplica por diez lo que se manda
//! por el socket.
//!
//! ## Sobre el texto
//!
//! ESC/POS no entiende UTF-8. Manda bytes de una tabla de códigos que hay que
//! seleccionar antes con `ESC t n`, y lo que no esté en esa tabla sale como
//! ruido. La conversión vive en `to_codepage`, con una regla explícita para
//! cada carácter del español y una caída a ASCII para lo demás: más vale
//! «jamon» que «jam¾n».

use std::time::Duration;

use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

/// Que un cable suelto no deje la caja colgada esperando.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const WRITE_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Deserialize, Clone)]
pub struct PrinterConfig {
    pub address: String,
    pub port: u16,
    /// 48 en papel de 80 mm, 32 en el de 58 mm.
    pub width_chars: usize,
    /// Valor de `ESC t n`: 2 = CP850, 19 = CP858, 16 = CP1252.
    pub codepage: u8,
    /// «partial», «full» o «none».
    pub cut_mode: String,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Left,
    Center,
    Right,
}

/// Un ticket es una lista de bloques. El diseño se decide en la interfaz, donde
/// ya vive el del PDF; aquí solo se convierte a bytes.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Block {
    Text {
        text: String,
        #[serde(default = "default_align")]
        align: Align,
        #[serde(default)]
        bold: bool,
        /// 0 normal, 1 doble alto, 2 doble alto y ancho.
        #[serde(default)]
        size: u8,
    },
    /// Etiqueta a la izquierda, importe a la derecha, relleno en medio.
    Row {
        left: String,
        right: String,
        #[serde(default)]
        bold: bool,
    },
    /// Línea separadora de ancho completo.
    Rule {
        #[serde(default)]
        dashed: bool,
    },
    Feed {
        #[serde(default = "default_feed")]
        lines: u8,
    },
    /// Abre el cajón. Va aquí y no en un comando aparte para que salga en el
    /// mismo envío que el ticket: dos conexiones seguidas dejan un hueco en el
    /// que el cajón se abre antes o después de que salga el papel.
    Drawer,
}

fn default_align() -> Align {
    Align::Left
}
fn default_feed() -> u8 {
    1
}

// --- Comandos ESC/POS -------------------------------------------------------
//
// Se dejan escritos como constantes con su nombre real del manual para que se
// puedan contrastar contra la documentación de Epson sin descifrar hexadecimal
// suelto.

/// `ESC @` — reinicia la impresora y deja los estilos a cero.
const INIT: &[u8] = &[0x1B, 0x40];
/// `ESC t n` — selecciona la tabla de códigos.
const CODEPAGE: u8 = 0x74;
/// `ESC a n` — 0 izquierda, 1 centro, 2 derecha.
const ALIGN: u8 = 0x61;
/// `ESC E n` — negrita.
const BOLD: u8 = 0x45;
/// `GS ! n` — tamaño: nibble alto ancho, nibble bajo alto.
const SIZE: &[u8] = &[0x1D, 0x21];
/// `GS V m` — corte. 66 = parcial tras avanzar, 65 = total tras avanzar.
const CUT: &[u8] = &[0x1D, 0x56];
/// `ESC p m t1 t2` — pulso al cajón por el conector RJ11 de la impresora.
///
/// El cajón no tiene red ni USB: cuelga de la impresora y se abre cuando esta
/// recibe este pulso. Por eso `printers.opens_drawer` dice cuál lo lleva.
/// m = 0 es el pin 2 (lo normal); 25 y 250 son los milisegundos de pulso, que
/// es lo que recomiendan Epson y las clónicas por igual.
const DRAWER: &[u8] = &[0x1B, 0x70, 0x00, 0x19, 0xFA];

/// Traduce un carácter Unicode a su byte en CP850 / CP858.
///
/// Las dos tablas comparten todo lo que importa en español; solo difieren en
/// unas casillas de dibujo y en el símbolo del euro, que aquí no se usa.
fn cp850_byte(c: char) -> Option<u8> {
    Some(match c {
        'Ç' => 0x80,
        'ü' => 0x81,
        'é' => 0x82,
        'â' => 0x83,
        'ä' => 0x84,
        'à' => 0x85,
        'ç' => 0x87,
        'ê' => 0x88,
        'ë' => 0x89,
        'è' => 0x8A,
        'ï' => 0x8B,
        'î' => 0x8C,
        'ì' => 0x8D,
        'Ä' => 0x8E,
        'É' => 0x90,
        'ô' => 0x93,
        'ö' => 0x94,
        'ò' => 0x95,
        'û' => 0x96,
        'ù' => 0x97,
        'Ö' => 0x99,
        'Ü' => 0x9A,
        'ø' => 0x9B,
        '£' => 0x9C,
        'á' => 0xA0,
        'í' => 0xA1,
        'ó' => 0xA2,
        'ú' => 0xA3,
        'ñ' => 0xA4,
        'Ñ' => 0xA5,
        'ª' => 0xA6,
        'º' => 0xA7,
        '¿' => 0xA8,
        '¡' => 0xAD,
        '«' => 0xAE,
        '»' => 0xAF,
        'Á' => 0xB5,
        'Â' => 0xB6,
        'À' => 0xB7,
        'ã' => 0xC6,
        'Ã' => 0xC7,
        'Í' => 0xD6,
        'Ó' => 0xE0,
        'Ú' => 0xE9,
        '°' => 0xF8,
        '·' => 0xFA,
        _ => return None,
    })
}

/// Lo que no está en la tabla se transcribe en vez de perderse.
///
/// Las comillas tipográficas y las rayas largas entran desde cualquier texto
/// copiado y pegado, y sin esto saldrían como basura en medio del ticket.
fn fallback(c: char) -> &'static str {
    match c {
        '—' | '–' | '−' => "-",
        '“' | '”' | '«' | '»' => "\"",
        '‘' | '’' => "'",
        '…' => "...",
        '€' => "EUR",
        '\u{00A0}' => " ",
        _ => "?",
    }
}

pub fn to_codepage(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c as u8);
        } else if let Some(b) = cp850_byte(c) {
            out.push(b);
        } else {
            out.extend_from_slice(fallback(c).as_bytes());
        }
    }
    out
}

/// Corta el texto al ancho del papel.
///
/// Se cuenta por CARACTERES y no por bytes: una vez convertido a CP850 cada
/// carácter ocupa uno, pero medir sobre el UTF-8 daría de más y partiría los
/// nombres con tilde antes de tiempo.
fn clip(text: &str, width: usize) -> String {
    text.chars().take(width).collect()
}

/// Etiqueta a la izquierda, importe a la derecha. Si no caben, manda el importe:
/// un nombre recortado se entiende, un precio recortado no.
fn row(left: &str, right: &str, width: usize) -> String {
    let right = clip(right, width);
    let room = width.saturating_sub(right.chars().count());
    let left = clip(left, room.saturating_sub(1));
    let pad = room - left.chars().count();
    format!("{left}{}{right}", " ".repeat(pad))
}

pub fn render(blocks: &[Block], config: &PrinterConfig) -> Vec<u8> {
    let width = config.width_chars.clamp(20, 96);
    let mut out = Vec::new();

    out.extend_from_slice(INIT);
    out.extend_from_slice(&[0x1B, CODEPAGE, config.codepage]);

    let mut drawer = false;

    for block in blocks {
        match block {
            Block::Text {
                text,
                align,
                bold,
                size,
            } => {
                out.extend_from_slice(&[
                    0x1B,
                    ALIGN,
                    match align {
                        Align::Left => 0,
                        Align::Center => 1,
                        Align::Right => 2,
                    },
                ]);
                if *bold {
                    out.extend_from_slice(&[0x1B, BOLD, 1]);
                }
                if *size > 0 {
                    // Doble alto siempre; doble ancho solo en el tamaño 2, que
                    // es el del TOTAL. A doble ancho caben la mitad de letras.
                    let n = if *size >= 2 { 0x11 } else { 0x01 };
                    out.extend_from_slice(SIZE);
                    out.push(n);
                }

                let usable = if *size >= 2 { width / 2 } else { width };
                for chunk in wrap(text, usable) {
                    out.extend_from_slice(&to_codepage(&chunk));
                    out.push(b'\n');
                }

                if *size > 0 {
                    out.extend_from_slice(SIZE);
                    out.push(0);
                }
                if *bold {
                    out.extend_from_slice(&[0x1B, BOLD, 0]);
                }
                out.extend_from_slice(&[0x1B, ALIGN, 0]);
            }

            Block::Row { left, right, bold } => {
                if *bold {
                    out.extend_from_slice(&[0x1B, BOLD, 1]);
                }
                out.extend_from_slice(&to_codepage(&row(left, right, width)));
                out.push(b'\n');
                if *bold {
                    out.extend_from_slice(&[0x1B, BOLD, 0]);
                }
            }

            Block::Rule { dashed } => {
                let c = if *dashed { '-' } else { '=' };
                out.extend_from_slice(&to_codepage(&c.to_string().repeat(width)));
                out.push(b'\n');
            }

            Block::Feed { lines } => {
                for _ in 0..*lines {
                    out.push(b'\n');
                }
            }

            Block::Drawer => drawer = true,
        }
    }

    // Antes de cortar hay que avanzar: la cuchilla está unos milímetros por
    // encima del cabezal, y sin esto se corta por la mitad de la última línea.
    out.extend_from_slice(b"\n\n\n\n");

    match config.cut_mode.as_str() {
        "full" => {
            out.extend_from_slice(CUT);
            out.push(65);
            out.push(0);
        }
        "none" => {}
        // Parcial por defecto: deja una pestaña sin cortar para que el ticket
        // no caiga al suelo.
        _ => {
            out.extend_from_slice(CUT);
            out.push(66);
            out.push(0);
        }
    }

    // El pulso va al final, después del corte: si fuera antes, el cajón se abre
    // mientras el papel todavía está saliendo y el cliente ve la caja abierta
    // antes que su ticket.
    if drawer {
        out.extend_from_slice(DRAWER);
    }

    out
}

/// Parte el texto por palabras, y por la fuerza si una sola palabra no cabe.
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for raw in text.split('\n') {
        let mut current = String::new();
        for word in raw.split_whitespace() {
            if word.chars().count() > width {
                if !current.is_empty() {
                    lines.push(std::mem::take(&mut current));
                }
                let chars: Vec<char> = word.chars().collect();
                for part in chars.chunks(width) {
                    lines.push(part.iter().collect());
                }
                continue;
            }
            let extra = if current.is_empty() { 0 } else { 1 };
            if current.chars().count() + extra + word.chars().count() > width {
                lines.push(std::mem::take(&mut current));
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        lines.push(current);
    }
    lines
}

async fn send(config: &PrinterConfig, bytes: &[u8]) -> Result<(), String> {
    let target = format!("{}:{}", config.address.trim(), config.port);

    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&target))
        .await
        .map_err(|_| format!("La impresora {target} no responde"))?
        .map_err(|e| format!("No se pudo conectar con {target}: {e}"))?;

    let mut stream = stream;
    // Sin esto, un paquete de 40 bytes se queda esperando compañía y el ticket
    // tarda medio segundo de más en salir.
    let _ = stream.set_nodelay(true);

    tokio::time::timeout(WRITE_TIMEOUT, stream.write_all(bytes))
        .await
        .map_err(|_| format!("Se agotó el tiempo enviando a {target}"))?
        .map_err(|e| format!("Error enviando a {target}: {e}"))?;

    stream
        .flush()
        .await
        .map_err(|e| format!("Error cerrando el envío a {target}: {e}"))
}

#[tauri::command]
pub async fn printer_print(config: PrinterConfig, blocks: Vec<Block>) -> Result<(), String> {
    let bytes = render(&blocks, &config);
    send(&config, &bytes).await
}

/// Abre el cajón sin imprimir. Para cuando hay que dar cambio de algo que no es
/// una venta.
#[tauri::command]
pub async fn printer_open_drawer(config: PrinterConfig) -> Result<(), String> {
    let mut bytes = Vec::from(INIT);
    bytes.extend_from_slice(DRAWER);
    send(&config, &bytes).await
}

/// Página de prueba. Lleva acentos y eñes a propósito: es lo único que dice si
/// la tabla de códigos elegida es la correcta, y se ve en el papel al instante.
#[tauri::command]
pub async fn printer_test(config: PrinterConfig) -> Result<(), String> {
    let blocks = vec![
        Block::Text {
            text: "PRUEBA DE IMPRESION".into(),
            align: Align::Center,
            bold: true,
            size: 1,
        },
        Block::Rule { dashed: true },
        Block::Text {
            text: "Año, jamón, ¿qué tal? ¡Sí! Ñandú".into(),
            align: Align::Left,
            bold: false,
            size: 0,
        },
        Block::Text {
            text: format!("Ancho: {} caracteres", config.width_chars),
            align: Align::Left,
            bold: false,
            size: 0,
        },
        Block::Rule { dashed: false },
        Block::Row {
            left: "Subtotal".into(),
            right: "C$ 1,234.50".into(),
            bold: false,
        },
        Block::Row {
            left: "TOTAL".into(),
            right: "C$ 1,419.68".into(),
            bold: true,
        },
    ];
    let bytes = render(&blocks, &config);
    send(&config, &bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(width: usize) -> PrinterConfig {
        PrinterConfig {
            address: "127.0.0.1".into(),
            port: 9100,
            width_chars: width,
            codepage: 2,
            cut_mode: "partial".into(),
        }
    }

    #[test]
    fn el_espanol_sobrevive_a_la_tabla_de_codigos() {
        // Si esto falla, en el papel salen símbolos raros en mitad del nombre.
        assert_eq!(to_codepage("ñ"), vec![0xA4]);
        assert_eq!(to_codepage("jamón"), vec![b'j', b'a', b'm', 0xA2, b'n']);
        assert_eq!(to_codepage("¿Qué?"), vec![0xA8, b'Q', b'u', 0x82, b'?']);
        assert_eq!(to_codepage("Ñandú"), vec![0xA5, b'a', b'n', b'd', 0xA3]);
    }

    #[test]
    fn lo_que_no_esta_en_la_tabla_se_transcribe() {
        assert_eq!(to_codepage("a—b"), b"a-b".to_vec());
        assert_eq!(to_codepage("“hola”"), b"\"hola\"".to_vec());
        assert_eq!(to_codepage("uno…"), b"uno...".to_vec());
        // Nada se pierde en silencio: siempre sale algo.
        assert!(!to_codepage("日本").is_empty());
    }

    #[test]
    fn la_fila_alinea_el_importe_a_la_derecha() {
        let r = row("Subtotal", "12.50", 24);
        assert_eq!(r.chars().count(), 24);
        assert!(r.starts_with("Subtotal"));
        assert!(r.ends_with("12.50"));
    }

    #[test]
    fn un_nombre_largo_no_empuja_el_importe_fuera() {
        let r = row("Croquetas de jamon iberico con salsa", "1234.56", 24);
        assert_eq!(r.chars().count(), 24);
        // El precio entero tiene que estar: recortarlo lo haría ilegible.
        assert!(r.ends_with("1234.56"));
    }

    #[test]
    fn el_ancho_se_cuenta_en_caracteres_no_en_bytes() {
        // «ñ» ocupa dos bytes en UTF-8 y uno en CP850. Medir en bytes partiría
        // las líneas antes de tiempo.
        let r = row("ñññññ", "1.00", 12);
        assert_eq!(r.chars().count(), 12);
        assert_eq!(to_codepage(&r).len(), 12);
    }

    #[test]
    fn el_texto_se_parte_al_ancho_del_papel() {
        let lines = wrap("uno dos tres cuatro cinco seis", 12);
        assert!(lines.iter().all(|l| l.chars().count() <= 12));
        assert_eq!(lines.join(" "), "uno dos tres cuatro cinco seis");
    }

    #[test]
    fn una_palabra_mas_larga_que_el_papel_se_parte_por_la_fuerza() {
        let lines = wrap("supercalifragilisticoespialidoso", 10);
        assert!(lines.iter().all(|l| l.chars().count() <= 10));
        assert_eq!(lines.concat(), "supercalifragilisticoespialidoso");
    }

    #[test]
    fn el_envio_empieza_reiniciando_y_eligiendo_tabla() {
        let bytes = render(&[], &cfg(48));
        assert_eq!(&bytes[0..2], INIT);
        assert_eq!(&bytes[2..5], &[0x1B, 0x74, 2]);
    }

    #[test]
    fn el_corte_depende_de_lo_configurado() {
        let partial = render(&[], &cfg(48));
        assert!(partial.ends_with(&[0x1D, 0x56, 66, 0]));

        let mut full = cfg(48);
        full.cut_mode = "full".into();
        assert!(render(&[], &full).ends_with(&[0x1D, 0x56, 65, 0]));

        let mut none = cfg(48);
        none.cut_mode = "none".into();
        let bytes = render(&[], &none);
        assert!(!bytes.windows(2).any(|w| w == [0x1D, 0x56]));
    }

    #[test]
    fn el_cajon_se_abre_despues_de_cortar() {
        let bytes = render(&[Block::Drawer], &cfg(48));
        assert!(bytes.ends_with(DRAWER));
        let cut = bytes.windows(2).position(|w| w == [0x1D, 0x56]).unwrap();
        let kick = bytes.windows(2).position(|w| w == [0x1B, 0x70]).unwrap();
        assert!(cut < kick, "el cajon no puede abrirse antes de salir el papel");
    }

    #[test]
    fn sin_bloque_de_cajon_no_hay_pulso() {
        let bytes = render(&[Block::Rule { dashed: true }], &cfg(48));
        assert!(!bytes.windows(2).any(|w| w == [0x1B, 0x70]));
    }

    #[test]
    fn la_regla_ocupa_el_ancho_exacto() {
        let bytes = render(&[Block::Rule { dashed: true }], &cfg(32));
        let dashes = bytes.iter().filter(|&&b| b == b'-').count();
        assert_eq!(dashes, 32);
    }
}
