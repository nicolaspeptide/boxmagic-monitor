const nodemailer = require('nodemailer');
const twilio = require('twilio');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  gimnasioID: 'oGDPQaGLb5',
  claseID: 'wa0e5oo0v6',
  usuarioID: 'ep4Q9nWV4a',
  boxmagicUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/horarios',
  horarios: {
    1: [19, 20], // Lunes
    2: [19, 20], // Martes
    3: [20],     // Miércoles
    5: [19],     // Viernes
  }
};

const DIAS_NOMBRE = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const INTERVALO_MINUTOS = 15;

function getFechaChile() {
  const ahora = new Date();
  const utc = ahora.getTime() + ahora.getTimezoneOffset() * 60000;
  return new Date(utc + (-3 * 60) * 60000);
}

function getFechasAMonitorear() {
  const hoy = getFechaChile();
  const diaHoy = hoy.getDay();
  const fechas = [];

  for (const [dia, horas] of Object.entries(CONFIG.horarios)) {
    const diaNum = parseInt(dia);
    if (diaNum < diaHoy) continue;

    const diff = diaNum - diaHoy;
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + diff);
    const fechaYMD = fecha.toISOString().split('T')[0];

    for (const hora of horas) {
      fechas.push({ diaNum, diaNombre: DIAS_NOMBRE[diaNum], fechaYMD, hora });
    }
  }

  return fechas;
}

async function getToken() {
  const loginRes = await fetch('https://api-bh.boxmagic.app/boxmagic/cuentas/ingresar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      correo: process.env.BOXMAGIC_EMAIL,
      contrasena: process.env.BOXMAGIC_PASSWORD
    })
  });
  const data = await loginRes.json();
  if (!data.token) throw new Error('No se pudo obtener token: ' + JSON.stringify(data));
  return data.token;
}

async function checkCupos() {
  const fechas = getFechasAMonitorear();
  const hoy = getFechaChile();

  if (fechas.length === 0) {
    console.log('No hay horarios que monitorear esta semana.');
    return;
  }

  console.log(`Hoy es ${DIAS_NOMBRE[hoy.getDay()]} → Monitoreando: ${[...new Set(fechas.map(f => f.diaNombre))].join(', ')}`);

  let token;
  try {
    token = await getToken();
    console.log('✅ Token obtenido');
  } catch(e) {
    console.error('❌ Error obteniendo token:', e.message);
    return;
  }

  const resultados = [];

  for (const { diaNombre, fechaYMD, hora } of fechas) {
    try {
      const res = await fetch(`https://api-bh.boxmagic.app/boxmagic/gimnasio/${CONFIG.gimnasioID}/instancias/porIDs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Gots-Gimnasio': CONFIG.gimnasioID
        },
        body: JSON.stringify({
          instancias: [{
            fechaYMD,
            claseID: CONFIG.claseID,
            horarioID: 'j80pXQEP0W' // se actualiza abajo
          }]
        })
      });

      const data = await res.json();

      if (data.instancias) {
        for (const key in data.instancias) {
          const inst = data.instancias[key];

          // Verificar hora
          const fechaInicio = new Date(inst.fechaInicio);
          const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
          const fechaChile = new Date(utc + (-3 * 60) * 60000);
          const horaClase = fechaChile.getHours();

          if (horaClase !== hora) continue;

          // ¿Ya tengo reserva?
          const yaReservado = data.participantes && data.participantes[CONFIG.usuarioID];
          if (yaReservado) {
            console.log(`⏭️  ${diaNombre} ${hora}:00hrs → Ya tienes reserva`);
            continue;
          }

          const espacios = inst.espaciosDisponibles;
          console.log(`🔍 ${diaNombre} ${hora}:00hrs → ${espacios} espacio(s)`);

          if (espacios > 0) {
            resultados.push({ diaNombre, hora, espacios });
          }
        }
      }
    } catch(e) {
      console.error(`❌ Error consultando ${diaNombre} ${hora}hrs:`, e.message);
    }
  }

  if (resultados.length > 0) {
    for (const r of resultados) {
      await sendNotification(r.diaNombre, r.hora, r.espacios);
    }
  } else {
    console.log('Sin cupos disponibles.');
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

async function loop() {
  while (true) {
    console.log(`\n⏰ ${getFechaChile().toLocaleString('es-CL')} — Iniciando revisión...`);
    await checkCupos().catch(console.error);
    console.log(`⏳ Próxima revisión en ${INTERVALO_MINUTOS} minutos.`);
    await new Promise(r => setTimeout(r, INTERVALO_MINUTOS * 60 * 1000));
  }
}

loop();
