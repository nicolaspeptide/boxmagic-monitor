const { chromium } = require('playwright-core');
const twilio = require('twilio');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  loginUrl:  'https://members.boxmagic.app/a/g?o=pi-e',
  perfilUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/perfil',
  gimnasioID: 'oGDPQaGLb5',
  email:     process.env.BOXMAGIC_EMAIL,
  password:  process.env.BOXMAGIC_PASSWORD,
};

const TWILIO = {
  sid:   process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  to:    process.env.TWILIO_WHATSAPP_TO,
  from:  'whatsapp:+14155238886',
};

const SLOTS = [
  { dia: 1, hora: '19:00', nombre: 'Lunes 19h',     claseID: 'Vd0jxy2Lrx', horarioID: 'Kp0Myj6E08' },
  { dia: 1, hora: '20:00', nombre: 'Lunes 20h',     claseID: 'gjLKb2rDRe', horarioID: '6XD9krv342' },
  { dia: 2, hora: '19:00', nombre: 'Martes 19h',    claseID: 'wa0eq7P0v6', horarioID: 'gjLK569Q0R' },
  { dia: 2, hora: '20:00', nombre: 'Martes 20h',    claseID: '8VLZORg4za', horarioID: 'WkD16ZV3L3' },
  { dia: 3, hora: '20:00', nombre: 'Miercoles 20h', claseID: 'gjLKb2rDRe', horarioID: '8k0zNyjx0n' },
  { dia: 5, hora: '19:00', nombre: 'Viernes 19h',   claseID: 'ep4QnlK0aQ', horarioID: 'j80pX8AY0W' },
];

const ANTI_SPAM_FILE = '/app/avisos_enviados.json';

function cargarAvisos() {
  try { return JSON.parse(fs.readFileSync(ANTI_SPAM_FILE, 'utf8')); } catch { return {}; }
}

function yaAvisado(key) {
  return !!cargarAvisos()[key];
}

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

async function obtenerPerfilYToken() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  let perfilData = null;
  let authToken = null;

  page.on('request', (request) => {
    const auth = request.headers()['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      authToken = auth.replace('Bearer ', '');
    }
  });

  page.on('response', async (response) => {
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
  } finally {
    await browser.close();
  }

  return { perfilData, authToken };
}

async function consultarCupos(instancias, authToken) {
  const url = 'https://api-bh.boxmagic.app/boxmagic/gimnasio/' + CONFIG.gimnasioID + '/instancias/porIDs';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken,
      'Origin': 'https://members.boxmagic.app',
    },
    body: JSON.stringify({ instancias: instancias }),
  });
  if (!response.ok) {
    console.log('porIDs error: ' + response.status);
    return null;
  }
  return await response.json();
}

function obtenerReservasAgendadas(perfil) {
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

function obtenerProximasFechas(slot, finVigencia) {
  const fechas = [];
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const d = new Date(hoy);
  while (d <= finVigencia) {
    if (d.getDay() === slot.dia) {
      const parts = slot.hora.split(':');
      const h = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const fechaClase = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      if (fechaClase > ahora) {
        fechas.push(d.toISOString().slice(0, 10));
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

async function main() {
  console.log(new Date().toLocaleString('es-CL') + ' - Iniciando revision...');

  limpiarAvisosViejos();

  const resultado = await obtenerPerfilYToken();
  const perfilData = resultado.perfilData;
  const authToken = resultado.authToken;

  if (!perfilData) { console.log('No se obtuvo perfil'); return; }
  if (!authToken)  { console.log('No se obtuvo token'); return; }

  console.log('Token obtenido');

  const datos = obtenerReservasAgendadas(perfilData);
  const reservasAgendadas = datos.reservasAgendadas;
  const finVigencia = datos.finVigencia;

  if (!finVigencia) { console.log('Sin membresia activa'); return; }
  console.log('Plan vigente hasta: ' + finVigencia.toISOString().slice(0, 10));
  console.log('Reservas agendadas: ' + reservasAgendadas.size);

  const pendientes = [];

  for (const slot of SLOTS) {
    const fechas = obtenerProximasFechas(slot, finVigencia);
    const fechasSinAgendar = [];

    for (const fecha of fechas) {
      const key = fecha + '_' + slot.horarioID;
      if (reservasAgendadas.has(key)) {
        console.log('Agendado: ' + slot.nombre + ' ' + fecha);
      } else if (yaAvisado(key)) {
        console.log('Ya avisado: ' + slot.nombre + ' ' + fecha);
      } else {
        fechasSinAgendar.push(fecha);
      }
    }

    if (fechasSinAgendar.length === 0) continue;

    const instancias = fechasSinAgendar.map(function(fecha) {
      return { fechaYMD: fecha, claseID: slot.claseID, horarioID: slot.horarioID };
    });

    console.log('Consultando disponibilidad: ' + slot.nombre + ' (' + fechasSinAgendar.length + ' fechas)');
    const respuesta = await consultarCupos(instancias, authToken);
    if (!respuesta) continue;

    const instanciasData = respuesta.instancias || respuesta;

    for (const fecha of fechasSinAgendar) {
      const instanciaID = 'i' + fecha + '>' + slot.claseID + '>' + slot.horarioID;
      const instancia = instanciasData[instanciaID] || instanciasData[fecha];

      if (!instancia) {
        console.log('Sin datos para: ' + slot.nombre + ' ' + fecha);
        continue;
      }

      const cuposMax = instancia.cupos || instancia.cuposMax || 6;
      const participantes = instancia.participantes || instancia.inscritos || 0;
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
    console.log('Sin clases disponibles sin agendar.');
    return;
  }

  const lineas = [
    'Boxmagic - Cupo disponible',
    '',
    'Hay ' + pendientes.length + ' clase(s) con cupo que no has agendado:',
    '',
  ];

  const porFecha = {};
  for (const item of pendientes) {
    if (!porFecha[item.fecha]) porFecha[item.fecha] = [];
    porFecha[item.fecha].push(item.slot.nombre + ' (' + item.cuposLibres + ' cupo(s))');
  }

  const fechasOrdenadas = Object.keys(porFecha).sort();
  for (const fecha of fechasOrdenadas) {
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

  const mensaje = lineas.join('\n');

  try {
    await enviarWhatsApp(mensaje);
    for (const item of pendientes) {
      marcarAvisado(item.key);
    }
  } catch (err) {
    console.log('Error WhatsApp: ' + err.message);
  }
}

main().catch(console.error);
