'use strict';
/*
 * Geração de QR Code no navegador (offline), usando vendor/qrcode-generator.js.
 * Antes isto vivia no store.js; com a base agora no servidor, o front-end só
 * precisa desta função para desenhar os QR Codes das fichas e etiquetas.
 * Expõe window.qrDataUrl(text, targetPx) → data URL (GIF) ou '' em caso de erro.
 */
(function (global) {
  function qrDataUrl(text, targetPx) {
    try {
      if (typeof global.qrcode === 'undefined') return '';
      const qr = global.qrcode(0, 'M');
      qr.addData(String(text == null ? '' : text));
      qr.make();
      const count = qr.getModuleCount();
      const margin = 1;
      const cell = Math.max(2, Math.round((targetPx || 220) / (count + margin * 2)));
      return qr.createDataURL(cell, margin);
    } catch (e) {
      console.warn('[patrimonio] falha ao gerar QR:', e && e.message);
      return '';
    }
  }
  global.qrDataUrl = qrDataUrl;
})(window);
