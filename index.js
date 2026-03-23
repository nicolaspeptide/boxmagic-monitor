const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  boxmagicUrl: 'https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios',
  gimnasioID: 'oGDPQaGLb5',
  claseID: 'wa0e5oo0v6',
  horarioID: 'j80pXQEP0W',
  fechaYMD: new Date().toISOString().split('T')[0]
};

async function checkCupos() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    let token = null;
    let cuposData = null;

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('tokenBM')) {
        const data = await response.json();
        if (data.token) token = data.token;
      }
      if (url.includes('porIDs')) {
        const data = await response.json();
        cuposData = data;
      }
    });

    await page.goto(CONFIG.boxmagicUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    await new Promise(r => setTimeout(r, 5000));

    if (cuposData) {
      const instancias = cuposData.instancias;
      for (const key in instancias) {
        const inst = instancias[key];
        if (inst.horarioID === CONFIG.horarioID) {
          console.log(`espaciosDisponibles: ${inst.espaciosDisponibles}`);
          if (inst.espaciosDisponibles > 0) {
            await sendNotification(inst.espaciosDisponibles);
          }
        }
      }
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
  
  console.log('Notificación enviada!');
}

checkCupos().catch(console.error);
