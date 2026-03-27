const { chromium } = require('playwright-core');
const twilio = require('twilio');
const fs = require('fs');

const CONFIG = {
  loginUrl:   'https://members.boxmagic.app/a/g?o=pi-e',
  perfilUrl:  'https://members.boxmagic.app/g/oGDPQaGLb5/perfil',
  horariosUrl:'https://members.boxmagic.app/g/oGDPQaGLb5/horarios',
  email:      process.env.BOXMAGIC_EMAIL,
  password:   process.env.BOXMAGIC_PASSWORD,
};

const TWILIO = {
  sid:   process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  to:    process.env.TWILIO_WHATSAPP_TO,
  from:  'whatsapp:+14155238886',
};

const SLOTS = [
  { dia: 1, hora: '19:00', nombre: 'Lunes 19h',     horarioID: 'Kp0Myj6E08' },
  { dia: 1, hora: '20:00', nombre: 'Lunes 20h',     horarioID: '6XD9krv342' },
  { dia: 2, hora: '19:00', nombre: 'Martes 19h',    horarioID: 'gjLK569Q0R' },
  { dia: 2, hora: '20:00', nombre: 'Martes 20h',    horarioID: 'WkD16ZV3L3' },
  { dia: 3, hora: '20:00', nombre: 'Miercoles 20h', horarioID: '8k0zNyjx0n' },
  { dia: 5, hora: '19:00', nombre: 'Viernes 19h',   horarioID: 'j80pX8AY0W' },
];

const ANTI_SPAM_FILE = '/app/avisos_enviados.json';

function cargarAvisos() {
  try { return JSON.parse(fs.readFileSync(ANTI_SPAM_FILE, 'utf8')); } catch { return {}; }
}
function yaAvisado(key) { return !!cargarAvisos()[key]; }
function marcarAvisado(key) {
  const avisos = cargarAvisos();
  avisos[key] = new Date().toISOString();
  fs.writeFileSync(ANTI_SPAM_FILE, JSON.stringify(avisos), 'utf8');
}
function limpiarAvisosViejos() {
  const avisos = cargarAvisos();
  const hoy = new Date().toISOString().slice(0, 10);
  const limpios = {};
  for (const [key, val] of Object.entries(avisos)) {
    if (key.split('_')[0] >= hoy) limpios[key] = val;
  }
  fs.writeFileSync(ANTI_SPAM_FILE, JSON.stringify(limpios), 'utf8');
}

async function enviarWhatsApp(mensaje) {
  const client = twilio(TWILIO.sid, TWILIO.token);
  await client.messages.create({ from: TWILIO.from, to: TWILIO.to, body: mensaje });
  console.log('WhatsApp enviado');
}

function obtenerProximasFechas(slot, finVigencia) {
  const fechas = [];
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const d = new Date(hoy);
  while (d <= finVigencia) {
    if (d.getDay() === slot.dia) {
      const parts = slot.hora.split(':');
      const fechaClase = new Date(d.getFullYear(), d.getMonth(), d.getDate(), parseInt(parts[0]), parseInt(parts[1]));
      if (fechaClase > ahora) {
        fechas.push(d.toISOString().slice(0, 10));
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

function obtenerReservasYVigencia(perfil) {
  const ahora = new Date();
  const membresiaActiva = Object.values(perfil.membresias || {}).find(function(m) {
    return m.activa && new Date(m.finVigencia) > ahora;
  });
  if (!membresiaActiva) return { reservasAgendadas: new Set(), finVigencia: null };
  const reservasAgendadas = new Set();
  for (const pago of Object.values(membresiaActiva.pagos || {})) {
    for (const periodo of Object.values(pago.periodosDeCupos || {})) {
      for (const reserva of Object.values(periodo.reservas || {})) {
        reservasAgendadas.add(reserva.fechaYMD + '_' + reserva.horarioID);
      }
    }
  }
  return { reservasAgendadas: reservasAgendadas, finVigencia: new Date(membresiaActiva.finVigencia) };
}

// Leer disponibilidad del DOM de la pagina de horarios
async function leerDisponibilidadDOM(page) {
  return await page.evaluate(function() {
    var resultado = {};

    // Buscar todas las tarjetas de clase visibles
    // BoxMagic muestra tarjetas con la fecha en el titulo y participantes/capacidad
    var tarjetas = document.querySelectorAll('[class*="card"], [class*="session"], [class*="clase"], [class*="instancia"], article, .presencial');

    // Si no hay tarjetas especificas, buscar por contenido
    if (tarjetas.length === 0) {
      tarjetas = document.querySelectorAll('div[class]');
    }

    tarjetas.forEach(function(tarjeta) {
      var texto = tarjeta.innerText || '';

      // Buscar el instanciaID en los links o atributos
      var links = tarjeta.querySelectorAll('a[href*="instanciaID"]');
      links.forEach(function(link) {
        var href = link.href || '';
        var match = href.match(/instanciaID=([^&]+)/);
        if (match) {
          var instanciaID = decodeURIComponent(match[1]);

          // Extraer participantes
          var partMatch = texto.match(/(\d+)\s*\/\s*(\d+)\s*Participantes/i) ||
                          texto.match(/Participantes\s*(\d+)\/(\d+)/i) ||
                          texto.match(/(\d+)\s*Participantes/i);

          var capacidadCompleta = texto.toLowerCase().includes('capacidad completa');
          var participantes = 0;
          var cuposMax = 6;

          if (partMatch) {
            if (partMatch[2]) {
              participantes = parseInt(partMatch[1]);
              cuposMax = parseInt(partMatch[2]);
            } else {
              participantes = parseInt(partMatch[1]);
            }
          }

          resultado[instanciaID] = {
            instanciaID: instanciaID,
            participantes: participantes,
            cuposMax: cuposMax,
            capacidadCompleta: capacidadCompleta,
            textoCompleto: texto.slice(0, 200),
          };
        }
      });

      // Tambien buscar por href en la tarjeta misma
      var hrefTarjeta = tarjeta.querySelector && tarjeta.querySelector('[href*="instanciaID"]');
      if (!hrefTarjeta && tarjeta.href && tarjeta.href.includes('instanciaID')) {
        hrefTarjeta = tarjeta;
      }
    });

    // Buscar directamente todos los links con instanciaID en la pagina
    var todosLosLinks = document.querySelectorAll('a[href*="instanciaID"], [href*="instanciaID"]');
    todosLosLinks.forEach(function(link) {
      var href = link.href || link.getAttribute('href') || '';
      var match = href.match(/instanciaID=([^&\s]+)/);
      if (match) {
        var instanciaID = decodeURIComponent(match[1]);
        if (!resultado[instanciaID]) {
          // Buscar el contenedor padre con info de participantes
          var contenedor = link.closest('[class]') || link.parentElement;
          var texto = '';
          for (var i = 0; i < 5; i++) {
            if (contenedor) {
              texto = contenedor.innerText || '';
              if (texto.includes('Participantes') || texto.includes('capacidad')) break;
              contenedor = contenedor.parentElement;
            }
          }

          var capacidadCompleta = texto.toLowerCase().includes('capacidad completa');
          var partMatch = texto.match(/(\d+)\s*\/\s*(\d+)\s*Participantes/i) ||
                          texto.match(/(\d+)\s*Participantes/i);
          var participantes = 0;
          var cuposMax = 6;
          if (partMatch) {
            participantes = parseInt(partMatch[1]);
            if (partMatch[2]) cuposMax = parseInt(partMatch[2]);
          }

          resultado[instanciaID] = {
            instanciaID: instanciaID,
            participantes: participantes,
            cuposMax: cuposMax,
            capacidadCompleta: capacidadCompleta,
            textoCompleto: texto.slice(0, 200),
          };
        }
      }
    });

    return resultado;
  });
}

async function main() {
  console.log(new Date().toLocaleString('es-CL') + ' - Iniciando revision...');
  limpiarAvisosViejos();

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  let perfilData = null;

  page.on('response', async function(response) {
    try {
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('application/json')) {
        const json = await response.json();
        if (json && json.perfilEnGimnasio) {
          perfilData = json.perfilEnGimnasio;
          console.log('Perfil interceptado');
        }
      }
    } catch (e) {}
  });

  try {
    console.log('Iniciando login...');
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"], input[name="email"]', CONFIG.email);
    await page.fill('input[type="password"], input[name="password"]', CONFIG.password);
    await page.click('button[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")');
    await page.waitForTimeout(3000);
    console.log('Login exitoso');

    await page.goto(CONFIG.perfilUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000);

    if (!perfilData) { console.log('No se obtuvo perfil'); return; }

    const datos = obtenerReservasYVigencia(perfilData);
    const reservasAgendadas = datos.reservasAgendadas;
    const finVigencia = datos.finVigencia;
    if (!finVigencia) { console.log('Sin membresia activa'); return; }

    console.log('Plan vigente hasta: ' + finVigencia.toISOString().slice(0, 10));
    console.log('Reservas agendadas: ' + reservasAgendadas.size);

    // Determinar fechas pendientes
    const fechasPendientesPorSlot = [];
    for (const slot of SLOTS) {
      const fechas = obtenerProximasFechas(slot, finVigencia);
      const sinAgendar = fechas.filter(function(fecha) {
        const key = fecha + '_' + slot.horarioID;
        if (reservasAgendadas.has(key)) {
          console.log('Agendado: ' + slot.nombre + ' ' + fecha);
          return false;
        }
        if (yaAvisado(key)) {
          console.log('Ya avisado: ' + slot.nombre + ' ' + fecha);
          return false;
        }
        return true;
      });
      if (sinAgendar.length > 0) {
        fechasPendientesPorSlot.push({ slot: slot, fechas: sinAgendar });
      }
    }

    if (fechasPendientesPorSlot.length === 0) {
      console.log('Todo agendado o ya avisado.');
      return;
    }

    // Ir a horarios y navegar semana por semana leyendo el DOM
    await page.goto(CONFIG.horariosUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    const disponibilidad = {};
    let semanasNavigadas = 0;
    const maxSemanas = 8;

    while (semanasNavigadas < maxSemanas) {
      // Leer que semana estamos viendo
      const semanaInfo = await page.evaluate(function() {
        // Buscar fechas visibles en los headers del calendario
        var headers = document.querySelectorAll('[class*="header"] [class*="date"], [class*="day"] span, thead th, [class*="calendar"] [class*="day"]');
        var textos = [];
        headers.forEach(function(h) { textos.push(h.innerText); });

        // Tambien buscar el boton de siguiente semana
        var btnSiguiente = document.querySelector('button[class*="next"], button[aria-label*="siguiente"], button[aria-label*="next"], [class*="next-week"]');

        return {
          headers: textos.slice(0, 10),
          tieneBtnSiguiente: !!btnSiguiente,
        };
      });

      console.log('Semana ' + (semanasNavigadas + 1) + ' - headers: ' + JSON.stringify(semanaInfo.headers.slice(0, 5)));

      // Leer disponibilidad del DOM actual
      const dispSemana = await leerDisponibilidadDOM(page);
      console.log('Instancias en DOM esta semana: ' + Object.keys(dispSemana).length);

      // Registrar todas las instancias encontradas
      for (const key of Object.keys(dispSemana)) {
        disponibilidad[key] = dispSemana[key];
        // Extraer fecha del instanciaID (formato: i2026-03-30>claseID>horarioID)
        const match = key.match(/i(\d{4}-\d{2}-\d{2})/);
        if (match) {
          console.log('Encontrado: ' + key.slice(0, 40) + ' | lleno: ' + dispSemana[key].capacidadCompleta + ' | part: ' + dispSemana[key].participantes);
        }
      }

      // Verificar si ya tenemos todas las fechas pendientes
      let todasEncontradas = true;
      for (const item of fechasPendientesPorSlot) {
        for (const fecha of item.fechas) {
          const instanciaID = 'i' + fecha + '>' + item.slot.horarioID;
          // Buscar con cualquier claseID
          const encontrado = Object.keys(disponibilidad).some(function(k) {
            return k.includes('i' + fecha) && k.includes(item.slot.horarioID);
          });
          if (!encontrado) {
            todasEncontradas = false;
          }
        }
      }

      if (todasEncontradas && semanasNavigadas > 0) {
        console.log('Todas las fechas encontradas en el DOM.');
        break;
      }

      // Navegar a la siguiente semana
      const avanzado = await page.evaluate(function() {
        // Buscar boton de siguiente semana/dia con varios selectores posibles
        var selectores = [
          'button[class*="next"]',
          'button[aria-label*="siguiente"]',
          'button[aria-label*="next"]',
          'button[aria-label*="Siguiente"]',
          '[class*="next-week"]',
          '[class*="nextWeek"]',
          'button:has-text(">")',
          'button:has-text("Siguiente")',
        ];

        for (var i = 0; i < selectores.length; i++) {
          var btn = document.querySelector(selectores[i]);
          if (btn) {
            btn.click();
            return true;
          }
        }

        // Buscar el ultimo boton de la barra de navegacion del calendario
        var botones = document.querySelectorAll('button');
        var btnNav = null;
        botones.forEach(function(b) {
          var txt = b.innerText || b.textContent || '';
          var cls = b.className || '';
          if (txt.includes('>') || txt.includes('›') || txt.includes('→') || cls.includes('next') || cls.includes('Next')) {
            btnNav = b;
          }
        });
        if (btnNav) {
          btnNav.click();
          return true;
        }

        return false;
      });

      if (!avanzado) {
        console.log('No se pudo avanzar a la siguiente semana en iteracion ' + (semanasNavigadas + 1));
        // Log del HTML para debug
        const html = await page.evaluate(function() {
          var botones = document.querySelectorAll('button');
          var info = [];
          botones.forEach(function(b) {
            info.push(b.className + ' | ' + (b.innerText || '').slice(0, 20));
          });
          return info.slice(0, 10).join(' || ');
        });
        console.log('Botones disponibles: ' + html);
        break;
      }

      await page.waitForTimeout(4000);
      semanasNavigadas++;
    }

    console.log('Total instancias en DOM: ' + Object.keys(disponibilidad).length);

    // Analizar disponibilidad
    const pendientes = [];

    for (const item of fechasPendientesPorSlot) {
      const slot = item.slot;
      for (const fecha of item.fechas) {
        // Buscar instancia por fecha y horarioID
        let instancia = null;
        for (const key of Object.keys(disponibilidad)) {
          if (key.includes('i' + fecha) && key.includes(slot.horarioID)) {
            instancia = disponibilidad[key];
            break;
          }
        }

        if (!instancia) {
          console.log('Sin datos DOM: ' + slot.nombre + ' ' + fecha);
          continue;
        }

        const cuposMax = instancia.cuposMax || 6;
        const participantes = instancia.participantes || 0;
        const cuposLibres = cuposMax - participantes;
        const capacidadCompleta = instancia.capacidadCompleta || cuposLibres <= 0;

        console.log(slot.nombre + ' ' + fecha + ': ' + participantes + '/' + cuposMax + ' -> ' + (capacidadCompleta ? 'LLENO' : cuposLibres + ' libre(s)'));

        if (!capacidadCompleta && cuposLibres > 0) {
          const key = fecha + '_' + slot.horarioID;
          pendientes.push({ slot: slot, fecha: fecha, key: key, cuposLibres: cuposLibres });
        }
      }
    }

    if (pendientes.length === 0) {
      console.log('Sin clases disponibles con cupo.');
      return;
    }

    const lineas = [
      'BoxMagic - Cupo disponible',
      '',
      'Hay ' + pendientes.length + ' clase(s) con cupo que no has agendado:',
      '',
    ];

    const porFecha = {};
    for (const item of pendientes) {
      if (!porFecha[item.fecha]) porFecha[item.fecha] = [];
      porFecha[item.fecha].push(item.slot.nombre + ' (' + item.cuposLibres + ' cupo(s))');
    }

    for (const fecha of Object.keys(porFecha).sort()) {
      const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', {
        weekday: 'long', day: 'numeric', month: 'long'
      });
      lineas.push(fechaLegible + ':');
      for (const nombre of porFecha[fecha]) {
        lineas.push('  ' + nombre);
      }
      lineas.push('');
    }

    lineas.push('Agenda en: members.boxmagic.app');

    try {
      await enviarWhatsApp(lineas.join('\n'));
      for (const item of pendientes) {
        marcarAvisado(item.key);
      }
    } catch (err) {
      console.log('Error WhatsApp: ' + err.message);
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
