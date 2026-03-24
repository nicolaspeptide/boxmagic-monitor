const { chromium } = require('playwright-core');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  boxmagicUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/horarios',
  usuarioID: 'ep4Q9nWV4a',
  horarios: {
    1: [19, 20], // Lunes
    2: [19, 20], // Martes
    3: [20],     // Miércoles
    5: [19],     // Viernes
  }
};

const DIAS_NOMBRE = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function getDiasRestantes() {
  // Día actual en Chile (GMT-3)
  const ahora = new Date();
  const chileOffset = -3 * 60;
  const utc = ahora.getTime() + ahora.getTimezoneOffset() * 60000;
  const horaChile = new Date(utc + chileOffset * 60000);
  const diaHoy = horaChile.getDay();

  // Filtrar días que quedan esta semana (desde hoy inclusive)
  const diasMonitorear = Object.keys(CONFIG.horarios)
    .map(Number)
    .filter(dia => dia >= diaHoy);

  return { diaHoy, diasMonitorear, horaChile };
}

async function checkCupos() {
  const { diaHoy, diasMonitorear } = getDiasRestantes();

  if (diasMonitorear.length === 0) {
    console.log('No quedan días que monitorear esta semana.');
    return;
  }

  console.log(`Hoy es ${DIAS_NOMBRE[diaHoy]} → Monitoreando días: ${diasMonitorear.map(d => DIAS_NOMBRE[d]).join(', ')}`);

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

              // Obtener día y hora en Chile
              const fechaInicio = new Date(inst.fechaInicio);
              const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
              const fechaChile = new Date(utc + (-3 * 60) * 60000);
              const diaClase = fechaChile.getDay();
              const horaClase = fechaChile.getHours();

              // ¿Es un día que monitoreamos?
              if (!diasMonitorear.includes(diaClase)) continue;

              // ¿Es una hora que nos interesa ese día?
              const horasDia = CONFIG.horarios[diaClase] || [];
              if (!horasDia.includes(horaClase)) continue;

              // ¿Ya tengo reserva en esta instancia?
              const yaReservado = data.participantes && data.participantes[CONFIG.usuarioID];
              if (yaReservado) {
                console.log(`⏭️  ${DIAS_NOMBRE[diaClase]} ${horaClase}:00hrs → Ya tienes reserva, se omite.`);
                continue;
              }

              const espacios = inst.espaciosDisponibles;
              console.log(`🔍 ${DIAS_NOMBRE[diaClase]} ${horaClase}:00hrs → ${espacios} espacio(s) disponible(s)`);

              if (espacios > 0) {
                resultados.push({ dia: DIAS_NOMBRE[diaClase], hora: horaClase, espacios });
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
        await sendNotification(r.dia, r.hora, r.espacios);
      }
    } else {
      console.log('Sin cupos disponibles.');
    }

  } finally {
    await browser.close();
  }
}

async function sendNotification(dia, hora, cupos) {
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
    subject: `🥊 ¡Cupo disponible ${dia} ${hora}:00hrs en BoxMagic!`,
    html: `<h2>¡Hay ${cupos} cupo(s) disponible(s)!</h2>
           <p>${dia} ${hora}:00-${hora+1}:00hrs tiene espacio ahora.</p>
           <a href="${CONFIG.boxmagicUrl}">Reservar ahora →</a>`
  });
  console.log(`📧 Email enviado: ${dia} ${hora}:00hrs`);

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: 'whatsapp:+14155238886',
    to: process.env.TWILIO_WHATSAPP_TO,
    body: `🥊 ¡Cupo disponible en BoxMagic!\n${dia} ${hora}:00-${hora+1}:00hrs\n${cupos} espacio(s)\nReserva: ${CONFIG.boxmagicUrl}`
  });
  console.log(`💬 WhatsApp enviado: ${dia} ${hora}:00hrs`);
}

checkCupos().catch(console.error);
