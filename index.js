const { chromium } = require('playwright-core');
const twilio = require('twilio');
const fs = require('fs');

const CONFIG = {
  loginUrl:   'https://members.boxmagic.app/a/g?o=pi-e',
  perfilUrl:  'https://members.boxmagic.app/g/oGDPQaGLb5/perfil',
  horariosUrl:'https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios',
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

// Leer todas las tarjetas de clases del DOM
// Las tarjetas NO son links — son divs/buttons con texto visible
async function leerTarjetasDOM(page) {
  return await page.evaluate(function() {
    var tarjetas = [];

    // El texto de la pagina contiene info de clases
    // Buscar todos los elementos que tengan "Participants" o "Participantes" o "capacity"
    var todos = document.querySelectorAll('*');
    var elementosTarjeta = [];

    todos.forEach(function(el) {
      var txt = el.innerText || '';
      // Un elemento tarjeta tiene participantes Y hora Y es relativamente pequeño
      if ((txt.includes('Participants') || txt.includes('Participantes')) &&
          txt.match(/\d+:\d+/) &&
          txt.length < 500 &&
          el.children.length > 0) {
        // Evitar duplicados — solo tomar el elemento mas especifico
        var esHijo = false;
        for (var i = 0; i < elementosTarjeta.length; i++) {
          if (elementosTarjeta[i].contains(el)) {
            // Ya tenemos un padre, reemplazar con hijo mas especifico
            elementosTarjeta[i] = el;
            esHijo = true;
            break;
          }
          if (el.contains(elementosTarjeta[i])) {
            esHijo = true;
            break;
          }
        }
        if (!esHijo) elementosTarjeta.push(el);
      }
    });

    elementosTarjeta.forEach(function(el) {
      var txt = (el.innerText || '').trim();

      // Extraer hora — formato "7:00pm to 8:00pm" o "19:00 a 20:00"
      var horaMatch = txt.match(/(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)/i) ||
                      txt.match(/(\d{1,2}):(\d{2})/);
      var hora = horaMatch ? horaMatch[0] : '';

      // Extraer participantes
      var partMatch = txt.match(/(\d+)\s*\/\s*(\d+)\s*(Participants|Participantes)/i) ||
                      txt.match(/(\d+)\s*(Participants|Participantes)/i);
      var participantes = partMatch ? parseInt(partMatch[1]) : 0;
      var cuposMax = (partMatch && partMatch[2] && !isNaN(parseInt(partMatch[2]))) ? parseInt(partMatch[2]) : 6;

      // Detectar capacidad completa
      var capacidadCompleta = txt.toLowerCase().includes('capacity full') ||
                              txt.toLowerCase().includes('capacidad completa') ||
                              txt.toLowerCase().includes('full capacity');

      // Buscar instanciaID en los atributos del elemento o sus hijos
      var instanciaID = '';
      var allEls = [el].concat(Array.from(el.querySelectorAll('*')));
      for (var i = 0; i < allEls.length; i++) {
        var e = allEls[i];
        var href = e.href || e.getAttribute('href') || e.getAttribute('data-instancia') || e.getAttribute('onclick') || '';
        var m = href.match(/instanciaID=([^&\s"']+)/);
        if (m) { instanciaID = decodeURIComponent(m[1]); break; }
        // Buscar en todos los atributos
        for (var j = 0; j < e.attributes.length; j++) {
          var val = e.attributes[j].value || '';
          var m2 = val.match(/instanciaID=([^&\s"']+)/);
          if (m2) { instanciaID = decodeURIComponent(m2[1]); break; }
          // Buscar formato i2026-XX-XX
          var m3 = val.match(/(i\d{4}-\d{2}-\d{2}>[^&\s"'>]+>[^&\s"'>]+)/);
          if (m3) { instanciaID = m3[1]; break; }
        }
        if (instanciaID) break;
      }

      // Extraer fecha del texto (formato MAR 26, MON 30, etc)
      var fechaMatch = txt.match(/(MON|TUE|WED|THU|FRI|SAT|SUN|LUN|MAR|MIE|JUE|VIE|SAB|DOM)\s+(\d+)/i);

      tarjetas.push({
        instanciaID: instanciaID,
        hora: hora,
        participantes: participantes,
        cuposMax: cuposMax,
        capacidadCompleta: capacidadCompleta,
        fechaTexto: fechaMatch ? fechaMatch[0] : '',
        textoCompleto: txt.slice(0, 150),
      });
    });

    return tarjetas;
  });
}

async function avanzarSemana(page) {
  // El boton siguiente tiene aria-label="Boton" — hay 6 botones iguales
  // El de siguiente semana es el ultimo (o penultimo)
  // Intentar con el boton que dice "next" en texto o el ultimo boton
  try { await page.click('button[class*="next"]', { timeout: 2000 }); return 'class:next'; } catch (e) {}
  try { await page.click('[class*="nextWeek"]', { timeout: 2000 }); return 'nextWeek'; } catch (e) {}
  try { await page.click('button[aria-label="next"]', { timeout: 2000 }); return 'aria:next'; } catch (e) {}
  try { await page.click('button[aria-label="Next"]', { timeout: 2000 }); return 'aria:Next'; } catch (e) {}

  // Buscar boton con texto "next" (en ingles porque la app esta en ingles)
  try { await page.click('button:has-text("next")', { timeout: 2000 }); return 'text:next'; } catch (e) {}
  try { await page.click('button:has-text("Next")', { timeout: 2000 }); return 'text:Next'; } catch (e) {}

  // El boton de siguiente semana aparece al pie como "Thursday 9" o similar
  // Intentar hacer clic en el ultimo boton de la pagina que no sea de navegacion
  const botones = await page.$$('button[aria-label="Boton"]');
  console.log('Botones con aria Boton: ' + botones.length);
  if (botones.length > 0) {
    // El ultimo boton suele ser "siguiente semana"
    await botones[botones.length - 1].click();
    return 'ultimo-boton-Boton';
  }

  return null;
}

async function main() {
  console.log(new Date().toLocaleString('es-CL') + ' - Iniciando revision...');
  limpiarAvisosViejos();

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
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

    console.log('Navegando a horarios...');
    await page.goto(CONFIG.horariosUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000);

    // Interceptar porIDs responses ademas de leer DOM
    const disponibilidadAPI = {};
    page.on('response', async function(response) {
      try {
        const url = response.url();
        if (url.includes('porIDs')) {
          const ct = response.headers()['content-type'] || '';
          if (ct.includes('application/json')) {
            const json = await response.json();
            if (json && typeof json === 'object') {
              for (const key of Object.keys(json)) {
                disponibilidadAPI[key] = json[key];
              }
              console.log('porIDs interceptado: ' + Object.keys(json).length + ' instancias');
            }
          }
        }
      } catch (e) {}
    });

    const disponibilidad = {};
    const maxSemanas = 8;

    for (var semana = 0; semana < maxSemanas; semana++) {
      // Leer tarjetas del DOM
      const tarjetas = await leerTarjetasDOM(page);
      console.log('Semana ' + (semana + 1) + ': ' + tarjetas.length + ' tarjetas en DOM');

      tarjetas.forEach(function(t) {
        console.log('  Tarjeta: hora=' + t.hora + ' part=' + t.participantes + '/' + t.cuposMax + ' lleno=' + t.capacidadCompleta + ' instID=' + t.instanciaID.slice(0, 40) + ' fecha=' + t.fechaTexto);
        if (t.instanciaID) {
          disponibilidad[t.instanciaID] = t;
        }
      });

      // Tambien registrar lo que llego via API
      for (const key of Object.keys(disponibilidadAPI)) {
        if (!disponibilidad[key]) {
          const d = disponibilidadAPI[key];
          disponibilidad[key] = {
            participantes: d.participantes || 0,
            cuposMax: d.cupos || 6,
            capacidadCompleta: d.capacidadCompleta || false,
          };
        }
      }

      const fechaMaxPendiente = fechasPendientesPorSlot
        .flatMap(function(i) { return i.fechas; }).sort().pop();
      const fechasEnDOM = Object.keys(disponibilidad)
        .map(function(k) { const m = k.match(/i(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; })
        .filter(Boolean).sort();
      const fechaMaxDOM = fechasEnDOM[fechasEnDOM.length - 1] || '';
      console.log('Max pendiente: ' + fechaMaxPendiente + ' | max en datos: ' + fechaMaxDOM + ' | total instancias: ' + Object.keys(disponibilidad).length);

      if (fechaMaxDOM >= fechaMaxPendiente && semana > 0) {
        console.log('Todas las fechas cubiertas.');
        break;
      }

      const resultado = await avanzarSemana(page);
      if (!resultado) {
        console.log('No se pudo avanzar semana.');
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
