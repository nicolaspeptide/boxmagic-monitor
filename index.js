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
const slotsReservados = new Set();

let tokenActual = process.env.BOXMAGIC_TOKEN;

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
    const dia = cursor.getDay();
    if (CONFIG.horarios[dia]) {
      for (const hora of CONFIG.horarios[dia]) {
        const fechaYMD = cursor.toISOString().split('T')[0];
        const slotKey = `${fechaYMD}-${hora}`;
        fechas.push({ diaNum: dia, diaNombre: DIAS_NOMBRE[dia], fechaYMD, hora, slotKey });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return fechas;
}

function getHeaders(conAuth = true) {
  const now = new Date().toISOString();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Gots-Ambiente': 'produccion',
    'Gots-App': 'members',
    'Gots-Dispositivo': 'web',
    'Gots-Gimnasio': CONFIG.gimnasioID,
    'Gots-Version': '5.72.41',
    'Mdt-Gim': now,
    'Mdt-Peg': now,
    'Mdt-Usr': now,
  };
  if (conAuth) headers['Authorization'] = `Bearer ${tokenActual}`;
  return headers;
}

async function renovarToken() {
  const res = await fetch('https://api-bh.boxmagic.app/boxmagic/cuentas/tokenBM', {
    method: 'GET',
    headers: getHeaders(true)
  });
  const data = await res.json();
  if (data.token) {
    tokenActual = data.token;
    console.log('🔄 Token renovado');
    return true;
  }
  throw new Error('No se pudo renovar token: ' + JSON.stringify(data));
}

async function checkCupos() {
  const hoy = getFechaChile();
  const todasLasFechas = getFechasDelMes();
  const fechasPendientes = todasLasFechas.filter(f => !slotsReservados.has(f.slotKey));

  if (fechasPendientes.length === 0) {
    console.log('🎉 ¡Todos los slots del mes están reservados!');
    return;
  }

  console.log(`Hoy es ${DIAS_NOMBRE[hoy.getDay()]} ${hoy.toLocaleDateString('es-CL')}`);
  console.log(`📅 Monitoreando ${fechasPendientes.length} slot(s) pendientes este mes`);

  try {
    await renovarToken();
  } catch(e) {
    console.error('❌ Error renovando token:', e.message);
    return;
  }

  const resultados = [];

  for (const { diaNombre, fechaYMD, hora, slotKey } of fechasPendientes) {
    try {
      const res = await fetch(`https://api-bh.boxmagic.app/boxmagic/gimnasio/${CONFIG.gimnasioID}/instancias/porIDs`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          instancias: [{
            fechaYMD,
            claseID: CONFIG.claseID,
            horarioID: 'j80pXQEP0W'
          }]
        })
      });

      const data = await res.json();

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
            slotsReservados.add(slotKey);
            continue;
          }

          const espacios = inst.espaciosDisponibles;
          console.log(`🔍 ${diaNombre} ${fechaYMD} ${hora}:00hrs → ${espacios} espacio(s)`);

          if (espacios > 0) {
            resultados.push({ diaNombre, fechaYMD, hora, espacios });
          }
        }
      } else {
        console.log(`⚠️  ${diaNombre} ${fechaYMD} ${hora}:00hrs → Sin datos`);
      }

      await new Promise(r => setTimeout(r, 500));

    } catch(e) {
      console.error(`❌ Error ${diaNombre} ${fechaYMD} ${hora}hrs:`, e.message);
    }
  }

  if (resultados.length > 0) {
    for (const r of resultados) {
      await sendNotification(r.diaNombre, r.fechaYMD, r.hora, r.espacios);
    }
  } else {
    console.log('Sin cupos disponibles.');
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
