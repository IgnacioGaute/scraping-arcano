import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import dotenv from 'dotenv';

dotenv.config();

async function leerPDF(rutaPDF) {
  if (!fs.existsSync(rutaPDF)) {
    console.warn(`El archivo PDF no existe: ${rutaPDF}`);
    return null;
  }
  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let texto = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(item => item.str).join(' ') + '\n';
  }

  const match = texto.match(/acceso:\s*([A-Z0-9]+)/i);
  return match?.[1] || null;
}

async function leerTextoCompletoPDF(rutaPDF) {
  if (!fs.existsSync(rutaPDF)) {
    console.warn(`El archivo PDF no existe: ${rutaPDF}`);
    return null;
  }
  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let texto = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(item => item.str).join(' ') + '\n';
  }
  return texto;
}

function mostrarMensajeFinal(texto) {
  const clean = texto.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const felicita = /FELICITACIONES[,!.\s]+MAESTRO DEL SCRAPING/i;
  const desafio = /DESAF.{0,5}COMPLETADO.{0,5}NIVEL MAESTRO/i;

  const match1 = clean.match(felicita);
  const match2 = clean.match(desafio);

  if (match1 && match2) {
    console.log('Mensaje especial encontrado en PDF:');
    console.log(match1[0]);
    console.log(match2[0]);
  } else {
    console.log('No se encontró el mensaje especial en el PDF.');
  }
}

async function descargarYExtraerCodigo(page, tituloLibro) {
  const libroSelector = `text=${tituloLibro}`;
  const contenedor = await page.locator(libroSelector).locator('xpath=ancestor::div[contains(@class, "group")]').first();

  const botonDescarga = contenedor.locator('button:has-text("Descargar PDF")');
  await botonDescarga.waitFor({ state: 'visible', timeout: 20000 });

  await page.waitForFunction(
    (btn) => !btn.disabled,
    await botonDescarga.elementHandle(),
    { timeout: 15000 }
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    botonDescarga.click()
  ]);

  const basePath = process.env.PDF_SAVE_PATH || './';
  const rutaPDF = path.resolve(basePath, `manuscrito-${tituloLibro.replace(/\s+/g, '_')}.pdf`);
  await download.saveAs(rutaPDF);
  console.log(`PDF guardado: ${rutaPDF}`);

  // No extraer código del último libro
  if (tituloLibro === 'Malleus Maleficarum') return null;

  const codigo = await leerPDF(rutaPDF);
  if (!codigo) {
    console.warn(`No se pudo extraer código del PDF: ${rutaPDF}`);
  } else {
    console.log(`Código extraído: ${codigo}`);
  }
  return codigo;
}

async function desbloquearLibro(page, tituloLibro, codigo) {
  const libroSelector = `text=${tituloLibro}`;
  const contenedor = await page.locator(libroSelector).locator('xpath=ancestor::div[contains(@class, "group")]').first();

  const input = contenedor.locator('input[placeholder="Ingresá el código"]');
  const boton = contenedor.locator('button:has-text("Desbloquear")');

  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(codigo);

  await page.waitForFunction(
    (el) => !el.disabled,
    await boton.elementHandle(),
    { timeout: 5000 }
  );

  await boton.click();
  await page.waitForTimeout(1000);
  console.log(`Desbloqueado: ${tituloLibro}`);
}

async function desbloquearLibroConDesafio(page, tituloLibro, codigo) {
  const libroSelector = `text=${tituloLibro}`;
  const contenedor = await page.locator(libroSelector).locator('xpath=ancestor::div[contains(@class, "group")]').first();

  const botonVerDoc = contenedor.locator('button:has-text("Ver Documentación")');
  if (await botonVerDoc.count() > 0) {
    await botonVerDoc.click();
    console.log(`Click en "Ver Documentación" para ${tituloLibro}`);

    const modal = page.locator('div[role="dialog"]');
    const botonCerrar = modal.locator('button[aria-label="Cerrar modal"]');
    await botonCerrar.waitFor({ state: 'visible', timeout: 10000 });
    await botonCerrar.click();
    await modal.waitFor({ state: 'hidden', timeout: 10000 });
    console.log(`Modal de documentación cerrado`);
  }

  const input = contenedor.locator('input[placeholder="Ingresá el código"]');
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.fill(codigo);

  const botonDesbloquear = contenedor.locator('button:has-text("Desbloquear")');
  await botonDesbloquear.waitFor({ state: 'visible', timeout: 10000 });

  await page.waitForFunction(
    (el) => !el.disabled,
    await botonDesbloquear.elementHandle(),
    { timeout: 10000 }
  );

  await botonDesbloquear.click();

  const modalDesbloqueado = page.locator('div[role="dialog"] >> text=¡Manuscrito Desbloqueado!');
  const botonCerrarDesbloqueado = page.locator('div[role="dialog"] button:has-text("Cerrar")');

  try {
    await modalDesbloqueado.waitFor({ state: 'visible', timeout: 10000 });
    await botonCerrarDesbloqueado.click();
    await modalDesbloqueado.waitFor({ state: 'hidden', timeout: 10000 });
    console.log(`Modal de éxito cerrado`);
  } catch {
    console.warn('No apareció modal de éxito o ya estaba cerrado');
  }

  await page.waitForTimeout(500);
  console.log(`Desbloqueado con desafío: ${tituloLibro}`);
}

function resolverDesafioNecronomicon(challenge) {
  const { vault, targets } = challenge;
  return targets.map(i => vault[i]).join('');
}

async function obtenerCodigoDesafioNecronomicon(tituloLibro, codigoAnterior) {
  const baseApi = process.env.URL_API_CHALLENGE;
  if (!baseApi) throw new Error('Falta la variable URL_API_CHALLENGE');

  const url = new URL(baseApi);
  url.searchParams.set('bookTitle', tituloLibro);
  url.searchParams.set('unlockCode', codigoAnterior);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Error al obtener código desafío para "${tituloLibro}": ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !data.challenge) {
    throw new Error(`Respuesta inválida para "${tituloLibro}"`);
  }

  return resolverDesafioNecronomicon(data.challenge);
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    const urlLogin = process.env.URL_LOGIN;
    const email = process.env.EMAIL;
    const password = process.env.PASSWORD;

    if (!urlLogin || !email || !password) throw new Error('Faltan variables de entorno');

    await page.goto(urlLogin, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type="submit"]'),
    ]);

    console.log('Login exitoso');

    const libros = [
      'Codex Aureus de Echternach',
      'Libro de Kells',
      'Codex Seraphinianus',
      'Necronomicon',
      'Malleus Maleficarum',
    ];

    let codigoExtraido = null;

    for (let i = 0; i < libros.length; i++) {
      const libro = libros[i];

      if (i > 0) {
        let codigoParaDesbloquear = codigoExtraido;

        if (i >= 3) {
          try {
            codigoParaDesbloquear = await obtenerCodigoDesafioNecronomicon(libro, codigoExtraido);
            console.log(`Código desafío para "${libro}": ${codigoParaDesbloquear}`);
          } catch (error) {
            console.error(error.message);
            break;
          }
        }

        if (!codigoParaDesbloquear || typeof codigoParaDesbloquear !== 'string') {
          console.log(`Código inválido para desbloquear ${libro}`);
          break;
        }

        if (i === 3) {
          try {
            const botonPagina2 = page.locator('button', { hasText: '2' });
            await botonPagina2.waitFor({ state: 'visible', timeout: 10000 });
            await botonPagina2.click();
            await page.waitForLoadState('networkidle');
            console.log('Navegando a la página 2');
          } catch {
            console.warn('Ya estás en la página 2 o no se pudo cambiar.');
          }
        }

        if (i >= 3) {
          await desbloquearLibroConDesafio(page, libro, codigoParaDesbloquear);
        } else {
          await desbloquearLibro(page, libro, codigoParaDesbloquear);
        }
      }

      const codigo = await descargarYExtraerCodigo(page, libro);

      if (libro === 'Malleus Maleficarum') {
        const basePath = process.env.PDF_SAVE_PATH || './';
        const rutaPDF = path.resolve(basePath, `manuscrito-${libro.replace(/\s+/g, '_')}.pdf`);
        const textoCompleto = await leerTextoCompletoPDF(rutaPDF);
        if (textoCompleto) mostrarMensajeFinal(textoCompleto);
        console.log('Último libro descargado, esperando unos segundos antes de finalizar...');
        await page.waitForTimeout(5000);
        break;
      }

      if (!codigo) {
        console.error(`No se pudo extraer código del libro ${libro}`);
        break;
      }

      codigoExtraido = codigo;
    }
  } catch (err) {
    console.error('Error general:', err);
  } finally {
    if (browser) await browser.close();
  }
})();
