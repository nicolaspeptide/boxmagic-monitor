const { chromium } = require('playwright-core');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  gimnasioID: 'oGDPQaGLb5',
  usuarioID: 'ep4Q9nWV4a',
  loginUrl: 'https://members.boxmagic.app/a/g?o=pi-e',
  boxmagicUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/horarios',
  slots: [
    { dia: 1, diaNombre: 'Lunes',     hora: 19, claseID: 'Vd0jxy2Lrx', horarioID: 'Kp0Myj6E08' },
    { dia: 1, diaNombre: 'Lunes',     hora: 20, claseID: 'gjLKb2rDRe', horarioID: '6XD9krv342' },
    { dia: 2, diaNombre: 'Martes',    hora: 19, claseID: 'wa0eq7P0v6', horarioID: 'gjLK569Q0R' },
    { dia: 2, diaNombre: 'Martes',    hora: 20, claseID: '8VLZORg4za', horarioID: 'WkD16ZV3L3' },
    { dia: 3, diaNombre: 'Miércoles', hora: 20, claseID: 'gjLKb2rDRe', horarioID: '8k0zNyjx0n' },
    { dia: 5, diaNombre: 'Viernes',   hora: 19, claseID: 'ep4QnlK0aQ', horarioID: 'j80pX8AY0W' },
  ]
};

const INTERVALO_MINUTOS = 15;
const slotsReservados = new Set();

function getFechaChile() {
  const ahora = new Date();
  const utc = ahora.getTime() + ahora.getTimezoneOffset() * 60000;
  return new Date(utc + (-3 * 60) * 60000);
}

function getFechasDelMes() {
  const hoy = getFechaChile();
  const fechas = [];
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const cursor = new Date(hoy);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= finMes) {
    const diaNum = cursor.getDay();
    const fechaYMD = cursor.toISOString().split('T')[0];
    for (const slot of CONFIG.slots) {
      if (slot.dia === diaNum) {
        const slotKey = `${fechaYMD}-${slot.hora}`;
        fechas.push({ ...slot, fechaYMD, slotKey });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return fechas;
}

async function login(page) {
  console.log('🔐 Iniciando login...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.fill('input[placeholder="Correo"]', process.env.BOXMAGIC_EMAIL);
  await page.fill('input[placeholder="Contraseña"]', process.env.BOXMAGIC_PASSWORD);
  await page.click('button:has-text("Ingresar")');
  await page.waitForTimeout(4000);
  console.log('✅ Login exitoso');
}

async function checkSlot(page, { diaNombre, fechaYMD, hora, claseID, horarioID }) {
  return new Promise(async (resolve) => {
    let resultado = null;

    const handler = async (response) => {
      if (response.url().includes('porIDs')) {
        try {
          const data = await response.json();
          if (data.instancias) {
            for (const key in data.instancias) {
              const inst = data.instancias[key];

              const fechaInicio = new Date(inst.fechaInicio);
              const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
              const fechaChile = new Date(utc + (-3 * 60) * 60000);
              const horaClase = fechaChile.getHours();
              if (horaClase !== hora) continue;

              const yaReservado = data.participantes && data.participantes[CONFIG.usuarioID];
              if (yaReservado) {
                console.log(`⏭️  ${diaNombre} ${fechaYMD} ${hora}:00hrs → Ya reservado`);
                resultado = { reservado: true };
                continue;
              }

              const espacios = inst.espaciosDisponibles;
              console.log(`🔍 ${diaNombre} ${fechaYMD} ${hora}:00hrs → ${espacios} espacio(s)`);
              resultado = { reservado: false, espacios };
            }
          }
        } catch(e) {}
      }
    };

    page.on('response', handler);
    const url = `${CONFIG.boxmagicUrl}?instanciaID=i${fechaYMD}>${claseID}>${horarioID}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    page.off('response', handler);
    resolve(resultado);
  });
}

async function checkCupos() {
  const hoy = getFechaChile();
  const todasLasFechas = getFechasDelMes();
  const fechasPendientes = todasLasFechas.filter(f => !slotsReservados.has(f.slotKey));

  if (fechasPendientes.length === 0) {
    console.log('🎉 ¡Todos los slots del mes están reservados!');
    return;
  }

  console.log(`Hoy es ${hoy.toLocaleDateString('es-CL', {weekday:'long', day:'numeric', month:'long'})}`);
  console.log(`📅 Monitoreando ${fechasPendientes.length} slot(s) pendientes este mes`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/ms-playwright/chromium-1091/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();

    // Login primero
    await login(page);

    const resultados = [];

    for (const slot of fechasPendientes) {
      const resultado = await checkSlot(page, slot);

      if (!resultado) {
        console.log(`⚠️  ${slot.diaNombre} ${slot.fechaYMD} ${slot.hora}:00hrs → Sin datos`);
        continue;
      }

      if (resultado.reservado) {
        slotsReservados.add(slot.slotKey);
        continue;
      }

      if (resultado.espacios > 0) {
        resultados.push({ ...slot, espacios: resultado.espacios });
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (resultados.length > 0) {
      for (const r of resultados) {
        await sendNotification(r.diaNombre, r.fechaYMD, r.hora, r.espacios);
      }
    } else {
      console.log('Sin cupos disponibles.');
    }

  } finally {
    await browser.close();
  }
}

async function sendNotification(dia, fechaYMD, hora, cupos) {
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: CONFIG.email,
    subject: `🥊 ¡Cupo disponible ${dia} ${fechaYMD} ${hora}:00hrs!`,
    html: `<h2>¡Hay ${cupos} cupo(s) disponible(s)!</h2>
           <p>${dia} ${fechaYMD} — ${hora}:00-${hora+1}:00hrs</p>
           <a href="${CONFIG.boxmagicUrl}">Reservar ahora →</a>`
  });
  console.log(`📧 Email enviado: ${dia} ${fechaYMD} ${hora}:00hrs`);

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: 'whatsapp:+14155238886',
    to: process.env.TWILIO_WHATSAPP_TO,
    body: `🥊 ¡Cupo disponible!\n${dia} ${fechaYMD}\n${hora}:00-${hora+1}:00hrs\n${cupos} espacio(s)\nReserva: ${CONFIG.boxmagicUrl}`
  });
  console.log(`💬 WhatsApp enviado: ${dia} ${fechaYMD} ${hora}:00hrs`);
}

async function loop() {
  while (true) {
    console.log(`\n⏰ ${getFechaChile().toLocaleString('es-CL')} — Iniciando revisión...`);
    await checkCupos().catch(console.error);
    console.log(`⏳ Próxima revisión en ${INTERVALO_MINUTOS} minutos.`);
    await new Promise(r => setTimeout(r, INTERVALO_MINUTOS * 60 * 1000));
  }
}

loop();
