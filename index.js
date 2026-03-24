const { chromium } = require('playwright-core');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  boxmagicUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/horarios',
  usuarioID: 'ep4Q9nWV4a',
  // Qué horas monitorear según el día (0=Dom, 1=Lun, 2=Mar, 3=Mie, 4=Jue, 5=Vie, 6=Sab)
  horarios: {
    1: [19, 20], // Lunes: 19 y 20hrs
    2: [19, 20], // Martes: 19 y 20hrs
    3: [20],     // Miércoles: 20hrs
    5: [19],     // Viernes: 19hrs
  }
};

function getHorasHoy() {
  const dia = new Date().getDay();
  return CONFIG.horarios[dia] || [];
}

async function checkCupos() {
  const horasHoy = getHorasHoy();

  if (horasHoy.length === 0) {
    console.log('Hoy no hay horarios que monitorear.');
    return;
  }

  console.log(`Monitoreando horas: ${horasHoy.join(', ')}hrs`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/ms-playwright/chromium-1091/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    const resultados = [];

    page.on('response', async (response) => {
      if (response.url().includes('porIDs')) {
        try {
          const data = await response.json();
          if (data.instancias) {
            for (const key in data.instancias) {
              const inst = data.instancias[key];

              // Obtener hora de inicio
              const fechaInicio = new Date(inst.fechaInicio);
              const hora = fechaInicio.getUTCHours() - 3; // GMT-3 Chile
              const horaLocal = hora < 0 ? hora + 24 : hora;

              // ¿Es una hora que nos interesa hoy?
              if (!horasHoy.includes(horaLocal)) continue;

              // ¿Ya tengo reserva?
              const yaReservado = data.participantes && data.participantes[CONFIG.usuarioID];
              if (yaReservado) {
                console.log(`${horaLocal}hrs: Ya tienes reserva, se omite.`);
                continue;
              }

              // ¿Hay espacios?
              const espacios = inst.espaciosDisponibles;
              console.log(`${horaLocal}hrs: ${espacios} espacio(s) disponible(s)`);

              if (espacios > 0) {
                resultados.push({ hora: horaLocal, espacios });
              }
            }
          }
        } catch(e) {}
      }
    });

    await page.goto(CONFIG.boxmagicUrl, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    if (resultados.length > 0) {
      for (const r of resultados) {
        await sendNotification(r.hora, r.espacios);
      }
    } else {
      console.log('Sin cupos disponibles.');
    }

  } finally {
    await browser.close();
  }
}

async function sendNotification(hora, cupos) {
  // Gmail
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
    subject: `🥊 ¡Cupo disponible ${hora}:00hrs en BoxMagic!`,
    html: `<h2>¡Hay ${cupos} cupo(s) disponible(s)!</h2>
           <p>Clase ${hora}:00-${hora+1}:00hrs tiene espacio ahora.</p>
           <a href="${CONFIG.boxmagicUrl}">Reservar ahora →</a>`
  });
  console.log(`Email enviado para ${hora}hrs!`);

  // WhatsApp
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: 'whatsapp:+14155238886',
    to: process.env.TWILIO_WHATSAPP_TO,
    body: `🥊 ¡Hay ${cupos} cupo(s) en BoxMagic!\nClase ${hora}:00-${hora+1}:00hrs\nReserva: ${CONFIG.boxmagicUrl}`
  });
  console.log(`WhatsApp enviado para ${hora}hrs!`);
}

checkCupos().catch(console.error);
