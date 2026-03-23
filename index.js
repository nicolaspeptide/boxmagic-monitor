const { chromium } = require('playwright-core');
const nodemailer = require('nodemailer');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  boxmagicUrl: 'https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios',
  horarioID: 'j80pXQEP0W',
};

async function checkCupos() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    let espaciosDisponibles = null;

    page.on('response', async (response) => {
      if (response.url().includes('porIDs')) {
        try {
          const data = await response.json();
          if (data.instancias) {
            for (const key in data.instancias) {
              const inst = data.instancias[key];
              if (inst.horarioID === CONFIG.horarioID) {
                espaciosDisponibles = inst.espaciosDisponibles;
                console.log(`Cupos disponibles: ${espaciosDisponibles}`);
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

    if (espaciosDisponibles > 0) {
      await sendNotification(espaciosDisponibles);
    } else {
      console.log('Sin cupos disponibles');
    }
  } finally {
    await browser.close();
  }
}

async function sendNotification(cupos) {
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
    subject: '🏋️ ¡Cupo disponible en BoxMagic!',
    html: `<h2>¡Hay ${cupos} cupo(s) disponible(s)!</h2>
           <p>Clase 19:00-20:00hrs tiene espacio ahora.</p>
           <a href="${CONFIG.boxmagicUrl}">Reservar ahora →</a>`
  });
  console.log('Email enviado!');
}

checkCupos().catch(console.error);
