const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuración de Gemini API
const GEMINI_API_KEY = 'AIzaSyClniu6ZTQTuNAYt1_4hGEkTCpsr7bBQVA';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Sistema de logging con colores
const log = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m[✓]\x1b[0m ${msg}`),
  error: (msg) => console.log(`\x1b[31m[✗]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[!]\x1b[0m ${msg}`),
  debug: (msg) => console.log(`\x1b[90m[DEBUG]\x1b[0m ${msg}`),
  bot: (msg) => console.log(`\x1b[35m[BOT]\x1b[0m ${msg}`),
  user: (user, msg) => console.log(`\x1b[34m[${user}]\x1b[0m ${msg}`)
};

// Manejadores de errores globales para evitar que el bot se caiga
process.on('uncaughtException', (error) => {
  log.error(`Error no capturado: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error(`Promesa rechazada: ${reason}`);
});

// Crear instancia del cliente
const client = new Client({
  puppeteer: {
    headless: true
  }
});

// Almacenar sesiones de usuarios en espera de credenciales
const userSessions = {};

// Cache de navegadores por usuario (para reutilizar sesión)
const browserCache = {};

// Cola de procesamiento para evitar sobrecarga
const requestQueue = [];
let isProcessing = false;

// URL de la página a autenticar
const LOGIN_URL = 'http://sidiumb.umb.edu.mx:8088';

// Timeout para operaciones de Puppeteer (30 segundos)
const PUPPETEER_TIMEOUT = 30000;

// Evento: Generar y mostrar código QR
client.on('qr', (qr) => {
  log.bot('═══════════════════════════════════════════════');
  log.bot('  Escanea el código QR con WhatsApp');
  log.bot('═══════════════════════════════════════════════');
  console.log('QR String:', qr);
  qrcode.generate(qr, { small: true });
});

// Evento: Cliente listo
client.on('ready', () => {
  log.success('═══════════════════════════════════════════════');
  log.success('  Bot de WhatsApp conectado y listo!');
  log.success('═══════════════════════════════════════════════');
});

// Evento: Mensaje recibido
client.on('message', async (message) => {
  const userId = message.from;
  const userMessage = message.body.toLowerCase().trim();

  try {
    // Actualizar última actividad
    updateUserActivity(userId);

    // Si el usuario no tiene sesión iniciada
    if (!userSessions[userId]) {
      // Responder a comandos iniciales
      if (userMessage === 'hola' || userMessage === 'inicio' || userMessage === 'iniciar sesión') {
        userSessions[userId] = { 
          step: 'waiting_username',
          lastActivity: Date.now()
        };
        await message.reply(
          `¡Bienvenido! 👋\n\nPara acceder a ${LOGIN_URL}, necesito tus credenciales.\n\n📝 Por favor, escribe tu *usuario*:`
        );
      } else {
        await message.reply(
          `Hola! 👋\n\nPara iniciar sesión, escribe: *hola*`
        );
      }
    } else {
      // Usuario está en proceso de login
      const session = userSessions[userId];

      if (session.step === 'waiting_username') {
        session.username = userMessage;
        session.step = 'waiting_password';
        session.lastActivity = Date.now();
        await message.reply(`Perfecto! Usuario: ${session.username}\n\n🔐 Ahora escribe tu *contraseña*:`);
      } 
      else if (session.step === 'waiting_password') {
        session.password = userMessage;
        session.step = 'processing';
        session.lastActivity = Date.now();

        // Mostrar que está procesando
        await message.reply('⏳ Verificando credenciales... por favor espera.');

        // Intentar autenticar
        try {
          const result = await authenticateUser(session.username, session.password);

          if (result.success) {
            // Guardar datos de sesión activa
            session.step = 'menu_opciones';
            session.studentData = result.studentData;

            // Mostrar menú de opciones
            await message.reply(
              `✅ *¡Inicio de sesión exitoso!*\n\n` +
              `¡Hola ${result.studentData.nombreCompleto || session.username}!\n\n` +
              `*Selecciona una opción escribiendo el número:*\n\n` +
              `0️⃣ Información del Estudiante\n` +
              `1️⃣ Historial Académico\n` +
              `2️⃣ Boleta de Calificaciones\n` +
              `3️⃣ Calificaciones Parciales\n` +
              `4️⃣ Solicitud Examen Extraordinario\n` +
              `5️⃣ Solicitud Examen ETS\n` +
              `6️⃣ Solicitud de Baja\n` +
              `7️⃣ Cambiar Contraseña\n` +
              `8️⃣ 🤖 Sugerencias de Estudio IA`
            );
          } else {
            await message.reply(
              `❌ *Error en la autenticación*\n\n` +
              `${result.message}\n\n` +
              `Por favor, intenta de nuevo escribiendo: *hola*`
            );
            delete userSessions[userId];
          }
        } catch (error) {
          await message.reply(
            `⚠️ *Error al procesar la solicitud:*\n${error.message}\n\n` +
            `Por favor, intenta de nuevo escribiendo: *hola*`
          );
          delete userSessions[userId];
        }
      }
      else if (session.step === 'menu_opciones') {
        const opcion = userMessage;

        if (opcion === '0') {
          await message.reply('👤 Obteniendo Información del Estudiante...');
          const resultado = await obtenerDatosAlumnos(session.username);
          if (resultado.success) {
            // Enviar información en texto
            let infoMsg = '👤 *INFORMACIÓN DEL ESTUDIANTE*\n\n';
            if (resultado.data.nombreCompleto) {
              infoMsg += `📝 *Nombre:* ${resultado.data.nombreCompleto}\n`;
            }
            if (resultado.data.matricula) {
              infoMsg += `🎓 *Matrícula:* ${resultado.data.matricula}\n`;
            }
            if (resultado.data.carrera) {
              infoMsg += `📚 *Carrera:* ${resultado.data.carrera}\n`;
            }
            if (resultado.data.ues) {
              infoMsg += `🏫 *UES:* ${resultado.data.ues}\n`;
            }
            if (resultado.data.promedioGeneral) {
              infoMsg += `📈 *Promedio General:* ${resultado.data.promedioGeneral}\n`;
            }
            if (resultado.data.promedioSemAnterior) {
              infoMsg += `📊 *Promedio Sem. Anterior:* ${resultado.data.promedioSemAnterior}\n`;
            }
            if (resultado.data.asigAprobadas) {
              infoMsg += `✅ *Asig. Aprobadas:* ${resultado.data.asigAprobadas}\n`;
            }
            if (resultado.data.asigReprobadas) {
              infoMsg += `❌ *Asig. Reprobadas:* ${resultado.data.asigReprobadas}\n`;
            }
            if (resultado.data.totalAsig) {
              infoMsg += `📋 *Total de Asig.:* ${resultado.data.totalAsig}\n`;
            }
            if (resultado.data.creditos) {
              infoMsg += `💳 *Créditos:* ${resultado.data.creditos}\n`;
            }
            if (resultado.data.porcentajeAvance) {
              infoMsg += `⏳ *Porcentaje de Avance:* ${resultado.data.porcentajeAvance}\n`;
            }
            if (resultado.data.regular) {
              infoMsg += `📌 *Regular:* ${resultado.data.regular}\n`;
            }
            await message.reply(infoMsg);
          } else {
            await message.reply(`❌ Error: ${resultado.message}`);
          }
          await message.reply('*Selecciona otra opción o escribe "salir" para terminar:*\n\n0️⃣ Información del Estudiante\n1️⃣ Historial Académico\n2️⃣ Boleta de Calificaciones\n3️⃣ Calificaciones Parciales\n4️⃣ Examen Extraordinario\n5️⃣ Examen ETS\n6️⃣ Solicitud de Baja\n7️⃣ Cambiar Contraseña');
        } else if (opcion === '1') {
          await message.reply('📚 Obteniendo Historial Académico...');
          const resultado = await obtenerHistorialAcademico(session.username);
          if (resultado.success) {
            const MessageMedia = require('whatsapp-web.js').MessageMedia;
            const fs = require('fs');

            // Enviar PDF si está disponible
            if (resultado.pdfPath && fs.existsSync(resultado.pdfPath)) {
              try {
                const pdfData = fs.readFileSync(resultado.pdfPath);
                const base64 = pdfData.toString('base64');
                const media = new MessageMedia('application/pdf', base64, 'Historial_Academico.pdf');
                await message.reply(media);
                fs.unlinkSync(resultado.pdfPath);
                
                let infoMsg = '📋 *HISTORIAL ACADÉMICO*\n\n';
                infoMsg += '✅ PDF descargado correctamente.\n';
                if (resultado.data.semestres && resultado.data.semestres.length > 0) {
                  infoMsg += `Semestres cursados: ${resultado.data.semestres.join(', ')}\n`;
                }
                await message.reply(infoMsg);
              } catch (err) {
                console.error('Error enviando PDF:', err);
                await message.reply('⚠️ Hubo un error al enviar el PDF.');
              }
            }
            // Si no hay PDF, enviar captura de pantalla
            else if (resultado.screenshot && fs.existsSync(resultado.screenshot)) {
              try {
                const imageData = fs.readFileSync(resultado.screenshot);
                const base64 = imageData.toString('base64');
                const media = new MessageMedia('image/png', base64, 'Historial_Academico.png');
                await message.reply(media);
                fs.unlinkSync(resultado.screenshot);
                
                let infoMsg = '📋 *HISTORIAL ACADÉMICO*\n\n';
                if (resultado.data.semestres && resultado.data.semestres.length > 0) {
                  infoMsg += `Semestres cursados: ${resultado.data.semestres.join(', ')}\n`;
                }
                infoMsg += '\n☝️ La imagen arriba muestra tu historial completo.';
                await message.reply(infoMsg);
              } catch (err) {
                console.error('Error enviando imagen:', err);
              }
            }
          } else {
            await message.reply(`❌ Error: ${resultado.message}`);
          }
          // Mostrar menú nuevamente
          await message.reply('*Selecciona otra opción o escribe "salir" para terminar:*\n\n1️⃣ Historial Académico\n2️⃣ Boleta de Calificaciones\n3️⃣ Calificaciones Parciales\n4️⃣ Examen Extraordinario\n5️⃣ Examen ETS\n6️⃣ Solicitud de Baja\n7️⃣ Cambiar Contraseña');
        } else if (opcion === '2') {
          await message.reply('📊 Obteniendo Boleta de Calificaciones...');
          const resultado = await obtenerBoletaCalificaciones(session.username);
          if (resultado.success) {
            // Enviar captura de pantalla
            if (resultado.screenshot) {
              const MessageMedia = require('whatsapp-web.js').MessageMedia;
              const fs = require('fs');

              try {
                const imageData = fs.readFileSync(resultado.screenshot);
                const base64 = imageData.toString('base64');
                const media = new MessageMedia('image/png', base64, 'Boleta_Calificaciones.png');
                await message.reply(media);

                // Limpiar archivo temporal
                fs.unlinkSync(resultado.screenshot);
              } catch (err) {
                console.error('Error enviando imagen:', err);
                await message.reply('✅ Boleta obtenida pero hubo un error al enviar la imagen.');
              }
            }

            // Enviar resumen de datos extraídos
            let infoMsg = '📋 *RESUMEN DE BOLETA*\n\n';
            if (resultado.data.promedio) {
              infoMsg += `📈 Promedio General: ${resultado.data.promedio}\n`;
            }
            if (resultado.data.aprobadas) {
              infoMsg += `✅ Asignaturas Aprobadas: ${resultado.data.aprobadas}\n`;
            }
            if (resultado.data.reprobadas) {
              infoMsg += `❌ Asignaturas Reprobadas: ${resultado.data.reprobadas}\n`;
            }
            if (resultado.data.creditos) {
              infoMsg += `📚 Créditos: ${resultado.data.creditos}\n`;
            }
            infoMsg += '\n☝️ La imagen arriba muestra tu boleta completa.';
            await message.reply(infoMsg);
          } else {
            await message.reply(`❌ Error: ${resultado.message}`);
          }
          // Mostrar menú nuevamente
          await message.reply('*Selecciona otra opción o escribe "salir" para terminar:*\n\n1️⃣ Historial Académico\n2️⃣ Boleta de Calificaciones\n3️⃣ Calificaciones Parciales\n4️⃣ Examen Extraordinario\n5️⃣ Examen ETS\n6️⃣ Solicitud de Baja\n7️⃣ Cambiar Contraseña');
        } else if (opcion === '3') {
          await message.reply('📈 Obteniendo Calificaciones Parciales...');
          const resultado = await obtenerCalificacionesParciales(session.username);
          if (resultado.success) {
            // Enviar captura de pantalla
            if (resultado.screenshot) {
              const MessageMedia = require('whatsapp-web.js').MessageMedia;
              const fs = require('fs');

              try {
                const imageData = fs.readFileSync(resultado.screenshot);
                const base64 = imageData.toString('base64');
                const media = new MessageMedia('image/png', base64, 'Calificaciones_Parciales.png');
                await message.reply(media);
                fs.unlinkSync(resultado.screenshot);
              } catch (err) {
                console.error('Error enviando imagen:', err);
              }
            }

            let infoMsg = '📋 *CALIFICACIONES PARCIALES*\n\n';
            if (resultado.data.periodo) {
              infoMsg += `📅 Período: ${resultado.data.periodo}\n`;
            }
            infoMsg += '\n☝️ La imagen arriba muestra tus calificaciones parciales completas.';
            await message.reply(infoMsg);
          } else {
            await message.reply(`❌ Error: ${resultado.message}`);
          }
          // Mostrar menú nuevamente
          await message.reply('*Selecciona otra opción o escribe "salir" para terminar:*\n\n1️⃣ Historial Académico\n2️⃣ Boleta de Calificaciones\n3️⃣ Calificaciones Parciales\n4️⃣ Examen Extraordinario\n5️⃣ Examen ETS\n6️⃣ Solicitud de Baja\n7️⃣ Cambiar Contraseña');
        } else if (opcion === '4') {
          await message.reply('📝 *Solicitud de Examen Extraordinario*\n\nEsta solicitud será enviada al departamento académico.\n¿Deseas continuar? (sí/no)');
          session.step = 'confirmar_extraordinario';
        } else if (opcion === '5') {
          await message.reply('📝 *Solicitud de Examen ETS*\n\nEsta solicitud será enviada al departamento académico.\n¿Deseas continuar? (sí/no)');
          session.step = 'confirmar_ets';
        } else if (opcion === '6') {
          await message.reply('⚠️ *Solicitud de Baja*\n\n⚠️ ATENCIÓN: Esta acción es irreversible.\n¿Estás seguro? (sí/no)');
          session.step = 'confirmar_baja';
        } else if (opcion === '7') {
          await message.reply('🔑 *Cambiar Contraseña*\n\nEscribe tu contraseña actual:');
          session.step = 'change_password_old';
        } else if (opcion === '8') {
          await message.reply('🤖 *Sugerencias de Estudio IA*\n\n⏳ Analizando tus materias y calificaciones...');
          try {
            const sugerencias = await obtenerSugerenciasIA(session.username, session.password);
            if (sugerencias.success) {
              await message.reply(sugerencias.mensaje);
            } else {
              await message.reply(`❌ Error: ${sugerencias.message}`);
            }
          } catch (error) {
            await message.reply(`❌ Error al generar sugerencias: ${error.message}`);
          }
        } else if (userMessage === 'salir') {
          await message.reply('👋 *¡Hasta luego!*\n\nTu sesión ha sido cerrada. Para volver a acceder, escribe: *hola*');
          delete userSessions[userId];
        } else {
          await message.reply('❌ Opción no válida. Por favor selecciona un número del 0 al 8 o escribe "salir".');
        }
      }
    }
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error.message);
    await message.reply('❌ Ocurrió un error inesperado. Por favor, intenta de nuevo o escribe *hola* para reiniciar.').catch(() => {});
  }
});

// Función auxiliar: Reintentar operación con backoff exponencial
async function retry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`⚠️ Intento ${i + 1} falló, reintentando en ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2; // Backoff exponencial
    }
  }
}

// Función auxiliar: Timeout para promesas
function withTimeout(promise, timeoutMs, errorMsg = 'Operación excedió el tiempo límite') {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
    )
  ]);
}

// Función para autenticar usuario con Puppeteer
async function authenticateUser(username, password) {
  let browser;
  try {
    log.info(`Autenticando usuario: ${username}`);

    // Lanzar navegador con timeout
    browser = await withTimeout(
      puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }),
      10000,
      'El navegador tardó demasiado en iniciar'
    );

    const page = await browser.newPage();

    // Navegar a la página de login con timeout
    log.debug(`Conectando al portal...`);
    await withTimeout(
      page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: PUPPETEER_TIMEOUT }),
      PUPPETEER_TIMEOUT,
      'No se pudo cargar la página de login'
    );

    // Rellenar formulario
    log.debug(`Enviando credenciales...`);
    await page.type('#ASPxFormLayout1_txtUsuario_I', username, { delay: 50 });
    await page.type('#ASPxFormLayout1_txtPassword_I', password, { delay: 50 });

    // Enviar formulario
    console.log(`✓ Enviando credenciales`);
    try {
      await Promise.all([
        page.click('#ASPxFormLayout1_btnAcceso_I'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
      ]);
    } catch (e) {
      // Si click falla, usar evaluate
      await page.evaluate(() => {
        const btn = document.getElementById('ASPxFormLayout1_btnAcceso_I');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    // Esperar para que la página procese
    await new Promise(r => setTimeout(r, 2000));

    // Obtener HTML después del login
    let html = await page.content();

    // Verificar si el login fue exitoso buscando el formulario de login
    if (html.includes('ASPxFormLayout1_txtUsuario')) {
      log.error(`Login fallido: ${username} - Credenciales incorrectas`);
      await browser.close();
      return {
        success: false,
        message: 'Usuario o contraseña incorrectos. Verifica tus credenciales e intenta nuevamente.'
      };
    }

    // Navegar a Alumnos
    console.log(`✓ Navegando a apartado de Alumnos`);
    await page.goto(LOGIN_URL + '/Alumnos', { waitUntil: 'networkidle2' }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    html = await page.content();

    // Extraer datos
    const datos = extraerDatosEstudiante(html);

    // Cerrar navegador
    await browser.close();

    log.success(`Login exitoso: ${username}`);
    return {
      success: true,
      message: 'Autenticación completada exitosamente',
      username: username,
      studentData: datos
    };

  } catch (error) {
    console.error('❌ Error en autenticación:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error cerrando navegador:', e.message);
      }
    }

    // Mensajes de error específicos
    let errorMessage = '';
    if (error.message.includes('timeout') || error.message.includes('tiempo')) {
      errorMessage = 'El servidor tardó demasiado en responder. Intenta nuevamente.';
    } else if (error.message.includes('net::ERR')) {
      errorMessage = 'No se pudo conectar al servidor. Verifica tu conexión.';
    } else {
      errorMessage = `Error: ${error.message}`;
    }

    return {
      success: false,
      message: errorMessage
    };
  }
}

// Función para obtener datos del apartado de Alumnos
async function obtenerDatosAlumnos(username) {
  let browser;
  try {
    log.debug(`Obteniendo datos de: ${username}`);

    // Lanzar navegador
    browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();
    await page.setViewport({ 
      width: 1920, 
      height: 1080,
      deviceScaleFactor: 2 
    });

    // Navegar a la página de login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

    // Rellenar y enviar formulario de login
    await page.type('#ASPxFormLayout1_txtUsuario_I', username);
    await page.type('#ASPxFormLayout1_txtPassword_I', username);

    try {
      await Promise.all([
        page.click('#ASPxFormLayout1_btnAcceso_I'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
      ]);
    } catch (e) {
      await page.evaluate(() => {
        const btn = document.getElementById('ASPxFormLayout1_btnAcceso_I');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    // La información del estudiante está en la página principal después del login
    
    // Esperar a que cargue el contenido
    try {
      await page.waitForFunction(
        () => !document.body.innerText.includes('Cargando…'),
        { timeout: 10000 }
      );
    } catch (e) {}
    
    await new Promise(r => setTimeout(r, 2000));

    const htmlPrincipal = await page.content();

    // Extraer datos del HTML
    const datos = extraerDatosEstudiante(htmlPrincipal);

    await browser.close();

    log.success(`Datos obtenidos: ${datos.nombreCompleto || 'Usuario'}`);
    return {
      success: true,
      data: datos,
      studentData: datos,
      rutaAcceso: '/'
    };

  } catch (error) {
    console.error('Error navegando a Alumnos:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }

    return {
      success: false,
      message: error.message,
      studentData: {},
      data: {}
    };
  }
}

// Función para extraer datos del estudiante
function extraerDatosEstudiante(html) {
  try {
    const $ = cheerio.load(html);
    const datos = {};

    // Extraer todo el texto del HTML
    const texto = $('body').text();

    // Buscar nombre del usuario (puede estar en varios formatos)
    let nombreMatch = texto.match(/Usuario[:\s]+([^:\n]+)(?=\n|Matrícula|$)/i);
    if (nombreMatch) {
      datos.nombreCompleto = nombreMatch[1].trim();
    }

    // Buscar matricula - varios formatos
    let matriculaMatch = texto.match(/Matrícula[:\s]*(\d+)/i);
    if (matriculaMatch) {
      datos.matricula = matriculaMatch[1];
    }

    // Buscar carrera - búsqueda más flexible
    let carreraMatch = texto.match(/Carrera[:\s]*([^:\n]+?)(?=UES|Promedio|Asig|$)/i);
    if (carreraMatch) {
      datos.carrera = carreraMatch[1].trim();
    }

    // Buscar UES
    let uesMatch = texto.match(/UES[:\s]*([^:\n]+?)(?=Promedio|Asig|Regular|$)/i);
    if (uesMatch) {
      datos.ues = uesMatch[1].trim();
    }

    // Buscar promedio general
    let promedioMatch = texto.match(/Promedio\s+(?:General|Sem\.\s+Anterior)[:\s]*([0-9.]+)/i);
    if (promedioMatch) {
      datos.promedioGeneral = promedioMatch[1];
    }

    // Buscar promedio semestre anterior específicamente
    let promSemMatch = texto.match(/Promedio\s+Sem\.\s+Anterior[:\s]*([0-9.]+)/i);
    if (promSemMatch) {
      datos.promedioSemAnterior = promSemMatch[1];
    }

    // Buscar asignaturas aprobadas
    let asigMatch = texto.match(/Asig\.\s+Aprobadas[:\s]*(\d+)/i);
    if (asigMatch) {
      datos.asigAprobadas = asigMatch[1];
    }

    // Buscar asignaturas reprobadas
    let reprobMatch = texto.match(/Asig\.\s+Reprobadas[:\s]*(\d+)/i);
    if (reprobMatch) {
      datos.asigReprobadas = reprobMatch[1];
    }

    // Buscar total de asignaturas
    let totalMatch = texto.match(/Total\s+de\s+Asig[.]*[:\s]*([0-9\/]+)/i);
    if (totalMatch) {
      datos.totalAsig = totalMatch[1].trim();
    }

    // Buscar créditos
    let creditosMatch = texto.match(/Créditos[:\s]*(\d+)/i);
    if (creditosMatch) {
      datos.creditos = creditosMatch[1];
    }

    // Buscar regular
    let regularMatch = texto.match(/Regular[:\s]*(\w+)/i);
    if (regularMatch) {
      datos.regular = regularMatch[1];
    }

    // Buscar porcentaje de avance
    let porcentajeMatch = texto.match(/Porcentaje\s+de\s+Avance[:\s]*([0-9.]+%?)/i);
    if (porcentajeMatch) {
      datos.porcentajeAvance = porcentajeMatch[1];
    }

    // Si no extrae muchos datos, mostrar primeras líneas para debugging
    if (Object.keys(datos).length < 3) {
      log.warn('Datos incompletos extraídos del HTML');
    }

    return datos;
  } catch (error) {
    console.error('Error extrayendo datos:', error);
    return {};
  }
}

// Función para formatear información del estudiante
function formatearInfoEstudiante(datos) {
  let mensaje = '📋 *INFORMACIÓN DEL ESTUDIANTE*\n\n';

  if (datos.nombreCompleto) {
    mensaje += `👤 *Nombre:* ${datos.nombreCompleto}\n`;
  }

  if (datos.matricula) {
    mensaje += `🎓 *Matrícula:* ${datos.matricula}\n`;
  }

  if (datos.carrera) {
    mensaje += `📚 *Carrera:* ${datos.carrera}\n`;
  }

  if (datos.ues) {
    mensaje += `🏫 *UES:* ${datos.ues}\n`;
  }

  mensaje += `\n*📊 CALIFICACIONES:*\n`;

  if (datos.promedioGeneral) {
    mensaje += `📈 *Promedio General:* ${datos.promedioGeneral}\n`;
  }

  if (datos.promedioSemAnterior) {
    mensaje += `📉 *Promedio Sem. Anterior:* ${datos.promedioSemAnterior}\n`;
  }

  if (datos.asigAprobadas) {
    mensaje += `✅ *Asignaturas Aprobadas:* ${datos.asigAprobadas}\n`;
  }

  if (datos.asigReprobadas) {
    mensaje += `❌ *Asignaturas Reprobadas:* ${datos.asigReprobadas}\n`;
  }

  if (datos.totalAsig) {
    mensaje += `📋 *Total de Asignaturas:* ${datos.totalAsig}\n`;
  }

  if (datos.creditos) {
    mensaje += `💳 *Créditos:* ${datos.creditos}\n`;
  }

  if (datos.porcentajeAvance) {
    mensaje += `⏳ *Porcentaje de Avance:* ${datos.porcentajeAvance}\n`;
  }

  if (datos.regular) {
    mensaje += `📌 *Regular:* ${datos.regular}\n`;
  }

  return mensaje;
}

// Evento: Desconexión
client.on('disconnected', (reason) => {
  console.log('❌ Bot desconectado:', reason);
});

// Evento: Error de autenticación
client.on('auth_failure', (error) => {
  console.error('Error de autenticación de WhatsApp:', error);
});

// Función para obtener Historial Académico
async function obtenerHistorialAcademico(username) {
  let browser;
  const fs = require('fs');
  const path = require('path');
  
  try {
    log.info('Obteniendo Historial Académico...');
    
    const downloadPath = '/tmp/downloads';
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }

    browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();
    
    // Configurar descarga de archivos
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath
    });
    
    await page.setViewport({ 
      width: 1920, 
      height: 1080,
      deviceScaleFactor: 2 
    });

    // Navegar a login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
    await page.type('#ASPxFormLayout1_txtUsuario_I', username);
    await page.type('#ASPxFormLayout1_txtPassword_I', username);

    try {
      await Promise.all([
        page.click('#ASPxFormLayout1_btnAcceso_I'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
      ]);
    } catch (e) {
      await page.evaluate(() => {
        const btn = document.getElementById('ASPxFormLayout1_btnAcceso_I');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    await new Promise(r => setTimeout(r, 2000));
    await page.goto(LOGIN_URL + '/Alumnos', { waitUntil: 'networkidle2' });

    const enlaceEncontrado = await page.evaluate(() => {
      const enlaces = Array.from(document.querySelectorAll('a'));
      const enlaceHistorial = enlaces.find(a => a.innerText.includes('Historial') || a.href.includes('Historial'));
      return enlaceHistorial ? enlaceHistorial.href : null;
    });

    if (enlaceEncontrado) {
      await page.goto(enlaceEncontrado, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));

      try {
        await page.waitForFunction(
          () => !document.body.innerText.includes('Cargando…'),
          { timeout: 10000 }
        );
      } catch (e) {}

      await new Promise(r => setTimeout(r, 2000));
    }

    // Buscar y hacer clic en el botón de PDF
    let pdfPath = null;
    
    // Primero, listar elementos relevantes para debug
    const elementosEncontrados = await page.evaluate(() => {
      const elementos = [];
      // Buscar imágenes con "pdf", "export", "acrobat"
      document.querySelectorAll('img').forEach(img => {
        const src = (img.src || '').toLowerCase();
        const alt = (img.alt || '').toLowerCase();
        if (src.includes('pdf') || src.includes('export') || src.includes('acrobat') || src.includes('download') ||
            alt.includes('pdf') || alt.includes('export') || alt.includes('descargar')) {
          elementos.push({ tipo: 'img', src: img.src, alt: img.alt, id: img.id });
        }
      });
      // Buscar input type="image"
      document.querySelectorAll('input[type="image"]').forEach(btn => {
        elementos.push({ tipo: 'input-image', src: btn.src, id: btn.id, name: btn.name });
      });
      // Buscar enlaces relevantes
      document.querySelectorAll('a').forEach(a => {
        const text = (a.innerText || '').toLowerCase();
        const href = (a.href || '').toLowerCase();
        if (text.includes('pdf') || text.includes('descargar') || text.includes('exportar') ||
            href.includes('pdf') || href.includes('export') || href.includes('download') ||
            a.hasAttribute('download')) {
          elementos.push({ tipo: 'enlace', href: a.href, text: a.innerText.substring(0, 30) });
        }
      });
      return elementos;
    });
    console.log('📋 Elementos encontrados:', JSON.stringify(elementosEncontrados, null, 2));
    
    const pdfButtonClicked = await page.evaluate(() => {
      // Buscar botón PDF por diferentes criterios (mejorado)
      const allElements = Array.from(document.querySelectorAll('a, button, input, img, span, div'));
      
      for (const el of allElements) {
        const text = (el.innerText || el.value || el.alt || el.title || '').toLowerCase();
        const src = (el.src || el.href || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const className = (el.className || '').toLowerCase();
        const onclick = (el.getAttribute('onclick') || '').toLowerCase();
        
        // Buscar por múltiples criterios más específicos
        if (text.includes('pdf') || text.includes('descargar') || text.includes('exportar') ||
            src.includes('pdf') || src.includes('acrobat') || src.includes('export') || src.includes('download') ||
            id.includes('pdf') || id.includes('export') || id.includes('download') ||
            className.includes('pdf') || className.includes('export') || className.includes('download') ||
            onclick.includes('pdf') || onclick.includes('export') ||
            (el.tagName === 'IMG' && (src.includes('acrobat') || src.includes('pdf_') || alt.includes('pdf'))) ||
            (el.tagName === 'A' && el.getAttribute('download'))) {
          
          console.log('Encontrado elemento PDF:', el.tagName, id, src.substring(0, 50));
          el.click();
          return { found: true, info: { tag: el.tagName, id: el.id, src: src.substring(0, 100), text: text.substring(0, 50) } };
        }
      }
      
      // Buscar específicamente input type="image"
      const imageInputs = document.querySelectorAll('input[type="image"]');
      for (const inp of imageInputs) {
        const src = (inp.src || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        if (src.includes('pdf') || src.includes('export') || src.includes('acrobat') || name.includes('pdf') || name.includes('export')) {
          console.log('Encontrado input PDF:', inp.src);
          inp.click();
          return { found: true, info: { tag: 'input-image', src: src.substring(0, 100), name: name } };
        }
      }
      
      return { found: false };
    });
    
    console.log('Resultado búsqueda PDF:', JSON.stringify(pdfButtonClicked));

    if (pdfButtonClicked && pdfButtonClicked.found) {
      console.log('✓ Botón PDF encontrado, descargando...');
      // Esperar a que se descargue el archivo
      await new Promise(r => setTimeout(r, 5000));
      
      // Buscar el archivo PDF descargado
      const files = fs.readdirSync(downloadPath);
      const pdfFile = files.find(f => f.endsWith('.pdf'));
      
      if (pdfFile) {
        pdfPath = path.join(downloadPath, pdfFile);
        console.log('✓ PDF descargado:', pdfPath);
      }
    }

    // Si no se pudo descargar PDF, tomar captura de pantalla como respaldo
    let screenshotPath = null;
    if (!pdfPath) {
      console.log('⚠️ No se pudo descargar PDF, tomando captura de pantalla...');
      
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });

      await new Promise(r => setTimeout(r, 1000));

      screenshotPath = `/tmp/historial_${username}_${Date.now()}.png`;
      await page.screenshot({ 
        path: screenshotPath, 
        fullPage: true,
        type: 'png'
      });
    }

    const htmlHistorial = await page.content();
    const datos = extraerHistorialAcademico(htmlHistorial);
    await browser.close();

    return { 
      success: true, 
      data: datos, 
      pdfPath: pdfPath,
      screenshot: screenshotPath 
    };
  } catch (error) {
    console.error('Error obteniendo historial:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    return { success: false, message: error.message };
  }
}

// Función para obtener Boleta de Calificaciones
async function obtenerBoletaCalificaciones(username) {
  let browser;
  try {
    log.info('Obteniendo Boleta de Calificaciones...');

    browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();
    await page.setViewport({ 
      width: 1920, 
      height: 1080,
      deviceScaleFactor: 2 
    });

    // Navegar a login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
    await page.type('#ASPxFormLayout1_txtUsuario_I', username);
    await page.type('#ASPxFormLayout1_txtPassword_I', username);

    try {
      await Promise.all([
        page.click('#ASPxFormLayout1_btnAcceso_I'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
      ]);
    } catch (e) {
      await page.evaluate(() => {
        const btn = document.getElementById('ASPxFormLayout1_btnAcceso_I');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    // Esperar a estar en la página de alumnos
    await new Promise(r => setTimeout(r, 2000));
    await page.goto(LOGIN_URL + '/Alumnos', { waitUntil: 'networkidle2' });

    // Buscar el enlace de Boleta de Calificaciones
    const enlaceEncontrado = await page.evaluate(() => {
      const enlaces = Array.from(document.querySelectorAll('a'));
      const enlaceBoleta = enlaces.find(a => a.innerText.includes('Boleta') || a.href.includes('CalificacionesParciales'));
      return enlaceBoleta ? enlaceBoleta.href : null;
    });

    if (enlaceEncontrado) {
      await page.goto(enlaceEncontrado, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));

      // Esperar a que desaparezca el "Cargando..."
      try {
        await page.waitForFunction(
          () => !document.body.innerText.includes('Cargando…'),
          { timeout: 10000 }
        );
      } catch (e) {
        console.log('Timeout esperando contenido, continuando...');
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    // Hacer scroll para asegurar que todo el contenido se cargue
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    // Tomar captura de pantalla con mejor calidad
    const screenshotPath = `/tmp/boleta_${username}_${Date.now()}.png`;
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: true,
      type: 'png'
    });

    const htmlBoleta = await page.content();
    const datos = extraerBoletaCalificaciones(htmlBoleta);

    await browser.close();

    return { 
      success: true, 
      data: datos,
      screenshot: screenshotPath
    };
  } catch (error) {
    console.error('Error obteniendo boleta:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    return { success: false, message: error.message };
  }
}

// Función para obtener Calificaciones Parciales
async function obtenerCalificacionesParciales(username) {
  let browser;
  try {
    log.info('Obteniendo Calificaciones Parciales...');

    browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();
    await page.setViewport({ 
      width: 1920, 
      height: 1080,
      deviceScaleFactor: 2 
    });

    // Navegar a login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
    await page.type('#ASPxFormLayout1_txtUsuario_I', username);
    await page.type('#ASPxFormLayout1_txtPassword_I', username);

    try {
      await Promise.all([
        page.click('#ASPxFormLayout1_btnAcceso_I'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
      ]);
    } catch (e) {
      await page.evaluate(() => {
        const btn = document.getElementById('ASPxFormLayout1_btnAcceso_I');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    await new Promise(r => setTimeout(r, 2000));
    await page.goto(LOGIN_URL + '/Alumnos', { waitUntil: 'networkidle2' });

    const enlaceEncontrado = await page.evaluate(() => {
      const enlaces = Array.from(document.querySelectorAll('a'));
      const enlaceParciales = enlaces.find(a => a.innerText.includes('Parciales') || a.href.includes('CalificacionesParciales'));
      return enlaceParciales ? enlaceParciales.href : null;
    });

    if (enlaceEncontrado) {
      await page.goto(enlaceEncontrado, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));

      try {
        await page.waitForFunction(
          () => !document.body.innerText.includes('Cargando…'),
          { timeout: 10000 }
        );
      } catch (e) {}

      await new Promise(r => setTimeout(r, 2000));
    }

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    const screenshotPath = `/tmp/parciales_${username}_${Date.now()}.png`;
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: true,
      type: 'png'
    });

    const htmlParciales = await page.content();
    const datos = extraerCalificacionesParciales(htmlParciales);
    await browser.close();

    return { success: true, data: datos, screenshot: screenshotPath };
  } catch (error) {
    console.error('Error obteniendo parciales:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    return { success: false, message: error.message };
  }
}

// Funciones para extraer datos específicos
function extraerHistorialAcademico(html) {
  const $ = cheerio.load(html);
  const datos = {
    semestres: [],
    totales: {}
  };

  const texto = $('body').text();

  // Buscar información de semestres
  const semestreMatch = texto.match(/[Ss]emestre[:\s]+(\d+)/g);
  if (semestreMatch) {
    datos.semestres = semestreMatch.map(s => s.replace(/[Ss]emestre[:\s]+/, ''));
  }

  return datos;
}

function extraerBoletaCalificaciones(html) {
  const $ = cheerio.load(html);
  const datos = {
    materias: [],
    promedio: null
  };

  const texto = $('body').text();

  // Buscar promedio
  const promedioMatch = texto.match(/[Pp]romedio[:\s]+([0-9.]+)/);
  if (promedioMatch) {
    datos.promedio = promedioMatch[1];
  }

  return datos;
}

function extraerCalificacionesParciales(html) {
  const $ = cheerio.load(html);
  const datos = {
    parciales: [],
    periodo: null
  };

  const texto = $('body').text();

  // Buscar período
  const periodoMatch = texto.match(/[Pp]eriodo[:\s]+([A-Z\s0-9\-]+)/);
  if (periodoMatch) {
    datos.periodo = periodoMatch[1].trim();
  }

  return datos;
}

// Función de limpieza: Cerrar sesiones inactivas
setInterval(() => {
  const now = Date.now();
  Object.keys(userSessions).forEach(userId => {
    const session = userSessions[userId];
    if (session.lastActivity && (now - session.lastActivity) > 600000) { // 10 minutos
      log.debug(`Limpiando sesión inactiva: ${userId}`);
      delete userSessions[userId];
    }
  });
}, 300000); // Cada 5 minutos

// Actualizar actividad de usuario
function updateUserActivity(userId) {
  if (userSessions[userId]) {
    userSessions[userId].lastActivity = Date.now();
  }
}

// ==========================================
// 🤖 FUNCIÓN: Obtener Sugerencias de Estudio con IA
// ==========================================
async function obtenerSugerenciasIA(username, password) {
  let browser;
  try {
    log.info(`🤖 Generando sugerencias IA para: ${username}`);

    // Lanzar navegador
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Navegar al portal
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: PUPPETEER_TIMEOUT });

    // Login
    await page.type('#ASPxFormLayout1_txtUsuario_I', username, { delay: 50 });
    await page.type('#ASPxFormLayout1_txtPassword_I', password, { delay: 50 });
    await Promise.all([
      page.click('#ASPxFormLayout1_btnAcceso_I'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: PUPPETEER_TIMEOUT }).catch(() => {})
    ]);

    await new Promise(r => setTimeout(r, 2000));

    // Navegar a Calificaciones Parciales (donde están las materias actuales)
    await page.goto('http://sidiumb.umb.edu.mx:8088/Servicios/Calificaciones_Parciales.aspx', {
      waitUntil: 'networkidle2',
      timeout: PUPPETEER_TIMEOUT
    });

    await new Promise(r => setTimeout(r, 2000));

    // Extraer HTML de la página
    const html = await page.content();
    const $ = cheerio.load(html);

    // Extraer datos del estudiante
    const texto = $('body').text();
    const nombreMatch = texto.match(/Usuario[:\s]+([^:\n]+)(?=\n|Matrícula|$)/i);
    const nombreCompleto = nombreMatch ? nombreMatch[1].trim() : username;
    const carreraMatch = texto.match(/Carrera[:\s]*([^:\n]+?)(?=UES|Promedio|Asig|$)/i);
    const carrera = carreraMatch ? carreraMatch[1].trim() : 'No especificada';

    // Extraer materias de la tabla
    const materias = [];
    $('table tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 3) {
        const materia = $(cols[1]).text().trim();
        const calificacion = $(cols[2]).text().trim();
        
        if (materia && materia.length > 3 && !materia.includes('Materia') && !materia.includes('Parcial')) {
          materias.push({
            nombre: materia,
            calificacion: calificacion || 'Sin calificación'
          });
        }
      }
    });

    await browser.close();

    if (materias.length === 0) {
      return {
        success: false,
        message: 'No se encontraron materias activas en el sistema.'
      };
    }

    log.success(`✓ Extraídas ${materias.length} materias`);

    // Generar sugerencias con IA (Gemini API)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `Eres un asistente educativo experto. Analiza las siguientes materias y calificaciones de un estudiante y proporciona sugerencias personalizadas de estudio.

**Estudiante:** ${nombreCompleto}
**Carrera:** ${carrera}

**Materias actuales:**
${materias.map((m, i) => `${i + 1}. ${m.nombre} - Calificación: ${m.calificacion}`).join('\n')}

Por favor proporciona:
1. 📊 Análisis general del desempeño
2. 🎯 Materias que requieren más atención (si hay calificaciones bajas)
3. 💡 3 sugerencias específicas de estudio
4. 🚀 Consejos para mejorar el rendimiento académico
5. ⏰ Recomendación de distribución de tiempo de estudio

Sé conciso, motivador y específico. Usa emojis para hacer el mensaje más amigable.`;

    const result = await model.generateContent(prompt);
    const sugerenciasIA = result.response.text();

    log.success('✓ Sugerencias generadas correctamente');

    // Formatear mensaje final
    const mensaje = `🤖 *Sugerencias de Estudio Personalizadas*\n\n` +
      `👤 *Estudiante:* ${nombreCompleto}\n` +
      `📚 *Carrera:* ${carrera}\n` +
      `📋 *Materias actuales:* ${materias.length}\n\n` +
      `───────────────────────────\n\n` +
      `${sugerenciasIA}\n\n` +
      `───────────────────────────\n\n` +
      `💪 *¡Tú puedes lograrlo!*\n` +
      `Recuerda: El éxito académico requiere constancia y dedicación.\n\n` +
      `_Sugerencias generadas por IA - Gemini 2.0_`;

    return {
      success: true,
      mensaje: mensaje,
      materias: materias
    };

  } catch (error) {
    log.error(`Error generando sugerencias IA: ${error.message}`);
    if (browser) await browser.close().catch(() => {});
    return {
      success: false,
      message: `Error al generar sugerencias: ${error.message}`
    };
  }
}

// Manejo de señales para cierre limpio
process.on('SIGINT', async () => {
  log.warn('\n\n⚠ Cerrando bot...');
  try {
    await client.destroy();
    log.success('Bot cerrado correctamente');
    process.exit(0);
  } catch (error) {
    log.error(`Error al cerrar: ${error.message}`);
    process.exit(1);
  }
});

// Inicializar cliente
log.bot('═══════════════════════════════════════════════════');
log.bot('  🤖 Iniciando bot de WhatsApp...');
log.bot('═══════════════════════════════════════════════════');
log.info('Comandos disponibles:');
log.info('  • hola → Iniciar sesión');
log.info('  • salir → Cerrar sesión');
log.bot('═══════════════════════════════════════════════════');
client.initialize();