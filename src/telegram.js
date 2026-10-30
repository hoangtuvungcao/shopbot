// Wrapper nhỏ cho Telegram Bot API. Không throw: lỗi được log và trả về {ok:false}.
export function createTg(token) {
  async function call(method, body = {}) {
    if (!token) return { ok: false, description: 'missing bot token' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
      if (!data.ok && !/message is not modified/.test(data.description || '')) {
        console.warn(`[tg] ${method}: ${data.description}`);
      }
      return data;
    } catch (e) {
      console.warn(`[tg] ${method} failed: ${e.message}`);
      return { ok: false, description: e.message };
    }
  }

  const base = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

  return {
    call,
    send: (chat_id, text, extra = {}) => call('sendMessage', { chat_id, text, ...base, ...extra }),
    edit: (chat_id, message_id, text, extra = {}) =>
      call('editMessageText', { chat_id, message_id, text, ...base, ...extra }),
    photo: (chat_id, photo, caption, extra = {}) =>
      call('sendPhoto', { chat_id, photo, caption, parse_mode: 'HTML', ...extra }),
    album: (chat_id, media) => call('sendMediaGroup', { chat_id, media }),
    del: (chat_id, message_id) => call('deleteMessage', { chat_id, message_id }),
    answer: (callback_query_id, text = '', show_alert = false) =>
      call('answerCallbackQuery', { callback_query_id, text, show_alert }),
  };
}

export const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });
export const btn = (text, data) => ({ text, callback_data: data });
export const urlBtn = (text, url) => ({ text, url });
