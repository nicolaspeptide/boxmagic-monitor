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
      if (fechaClase > ahora) fechas.push(d.toISOString().slice(0, 10));
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

async function leerDisponibilidadDOM(page) {
  return await page.evaluate(function() {
    var resultado = {};
    var todosLosLinks = document.querySelectorAll('a[href*="instanciaID"]');
    todosLosLinks.forEach(function(link) {
      var href = link.href || link.getAttribute('href') || '';
      var match = href.match(/instanciaID=([^&\s]+)/);
      if (match) {
        var instanciaID = decodeURIComponent(match[1]);
        if (!resultado[instanciaID]) {
          var contenedor = link;
          var texto = '';
          for (var i = 0; i < 8; i++) {
            if (contenedor) {
              texto = contenedor.innerText || '';
              if (texto.includes('Participantes') || texto.toLowerCase().includes('capacidad')) break;
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
          };
        }
      }
    });
    return resultado;
  });
}

async function avanzarSemana(page) {
  return await page.evaluate(function() {
    var selectores = [
      'button[class*="next"]',
      'button[aria-label*="siguiente"]',
      'button[aria-label*="next"]',
      'button[aria-label*="Siguiente"]',
      '[class*="next-week"]',
      '[class*="nextWeek"]',
    ];
    for (var i = 0; i < selectores.length; i++) {
      var btn = document.querySelector(selectores[i]);
      if (btn) { btn.click(); return 'selector:' + selectores[i]; }
    }
    var botones = document.querySelectorAll('button');
    var encontrado = null;
    botones.forEach(function(b) {
      if (encontrado) return;
      var txt = (b.innerText || b.textContent || '').trim();
      var cls = b.className || '';
      if (txt === '>' || txt === '\u203a' || txt === '\u2192' || txt === '>>' ||
          cls.includes('next') || cls.includes('Next') ||
          cls.includes('forward') || cls.includes('right')) {
        encontrado = b;
      }
    });
    if (encontrado) { encontrado.click(); return 'texto:' + (encontrado.innerText || encontrado.className).slice(0, 30); }
    return null;
  });
}

async function main() {
  console.log(new Date().toLocaleString('es-CL') + ' - Iniciando revision...');
  limpiarAvisosViejos();

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  // Sin bloquear service worker para que la app cargue correctamente
  const context = await browser.newContext();
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

    const fechasPendientesPorSlot = [];
    for (const slot of SLOTS) {
      const fechas = obtenerProximasFechas(slot, finVigencia);
      const sinAgendar = fechas.filter(function(fecha) {
        const key = fecha + '_' + slot.horarioID;
        if (reservasAgendadas.has(key)) { console.log('Agendado: ' + slot.nombre + ' ' + fecha); return false; }
        if (yaAvisado(key)) { console.log('Ya avisado: ' + slot.nombre + ' ' + fecha); return false; }
        return true;
      });
      if (sinAgendar.length > 0) fechasPendientesPorSlot.push({ slot: slot, fechas: sinAgendar });
    }

    if (fechasPendientesPorSlot.length === 0) {
      console.log('Todo agendado o ya avisado.');
      return;
    }

    // Ir a horarios
    await page.goto(CONFIG.horariosUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);

    // Debug: ver que hay en el DOM
    const debugInfo = await page.evaluate(function() {
      return {
        title: document.title,
        links: document.querySelectorAll('a[href*="instanciaID"]').length,
        botones: document.querySelectorAll('button').length,
        htmlSnippet: document.body.innerHTML.slice(0, 800),
      };
    });
    console.log('DOM debug - title: ' + debugInfo.title);
    console.log('DOM debug - links instanciaID: ' + debugInfo.links);
    console.log('DOM debug - botones: ' + debugInfo.botones);
    console.log('DOM debug - html: ' + debugInfo.htmlSnippet.replace(/\n/g, ' ').slice(0, 400));

    const disponibilidad = {};
    const maxSemanas = 8;

    for (var semana = 0; semana < maxSemanas; semana++) {
      const dispSemana = await leerDisponibilidadDOM(page);
      const count = Object.keys(dispSemana).length;
      console.log('Semana ' + (semana + 1) + ': ' + count + ' instancias en DOM');

      for (const key of Object.keys(dispSemana)) {
        disponibilidad[key] = dispSemana[key];
        console.log('  ' + key.slice(0, 50) + ' | lleno:' + dispSemana[key].capacidadCompleta + ' part:' + dispSemana[key].participantes + '/' + dispSemana[key].cuposMax);
      }

      const fechaMaxPendiente = fechasPendientesPorSlot
        .flatMap(function(i) { return i.fechas; })
        .sort().pop();

      const fechasEnDOM = Object.keys(disponibilidad)
        .map(function(k) { const m = k.match(/i(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; })
        .filter(Boolean).sort();
      const fechaMaxDOM = fechasEnDOM[fechasEnDOM.length - 1] || '';

      console.log('Max pendiente: ' + fechaMaxPendiente + ' | max DOM: ' + fechaMaxDOM);

      if (fechaMaxDOM >= fechaMaxPendiente && semana > 0) {
        console.log('Todas las fechas cubiertas.');
        break;
      }

      const resultado = await avanzarSemana(page);
      if (!resultado) {
        const btnInfo = await page.evaluate(function() {
          var bs = document.querySelectorAll('button');
          var info = [];
          bs.forEach(function(b) {
            info.push((b.className || '').slice(0, 40) + '|' + (b.innerText || '').slice(0, 15));
          });
          return info.slice(0, 20).join(' || ');
        });
        console.log('Sin boton siguiente. Botones: ' + btnInfo);
        break;
      }
      console.log('Avanzando: ' + resultado);
      await page.waitForTimeout(5000);
    }

    console.log('Total instancias: ' + Object.keys(disponibilidad).length);

    const pendientes = [];
    for (const item of fechasPendientesPorSlot) {
      const slot = item.slot;
      for (const fecha of item.fechas) {
        let instancia = null;
        for (const key of Object.keys(disponibilidad)) {
          if (key.includes('i' + fecha) && key.includes(slot.horarioID)) {
            instancia = disponibilidad[key];
            break;
          }
        }
        if (!instancia) { console.log('Sin datos: ' + slot.nombre + ' ' + fecha); continue; }
        const cuposMax = instancia.cuposMax || 6;
        const participantes = instancia.participantes || 0;
        const cuposLibres = cuposMax - participantes;
        const capacidadCompleta = instancia.capacidadCompleta || cuposLibres <= 0;
        console.log(slot.nombre + ' ' + fecha + ': ' + participantes + '/' + cuposMax + ' -> ' + (capacidadCompleta ? 'LLENO' : cuposLibres + ' libre(s)'));
        if (!capacidadCompleta && cuposLibres > 0) {
          pendientes.push({ slot: slot, fecha: fecha, key: fecha + '_' + slot.horarioID, cuposLibres: cuposLibres });
        }
      }
    }

    if (pendientes.length === 0) { console.log('Sin clases con cupo.'); return; }

    const lineas = ['BoxMagic - Cupo disponible', '', 'Hay ' + pendientes.length + ' clase(s) con cupo que no has agendado:', ''];
    const porFecha = {};
    for (const item of pendientes) {
      if (!porFecha[item.fecha]) porFecha[item.fecha] = [];
      porFecha[item.fecha].push(item.slot.nombre + ' (' + item.cuposLibres + ' cupo(s))');
    }
    for (const fecha of Object.keys(porFecha).sort()) {
      const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
      lineas.push(fechaLegible + ':');
      for (const nombre of porFecha[fecha]) lineas.push('  ' + nombre);
      lineas.push('');
    }
    lineas.push('Agenda en: members.boxmagic.app');

    try {
      await enviarWhatsApp(lineas.join('\n'));
      for (const item of pendientes) marcarAvisado(item.key);
    } catch (err) {
      console.log('Error WhatsApp: ' + err.message);
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
