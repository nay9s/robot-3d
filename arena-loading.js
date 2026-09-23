export function createLoadingController(documentRef, delay = 10000) {
  const message = documentRef.querySelector('#webgl-error');
  let terminalFailure = false;

  const timeoutId = window.setTimeout(() => {
    if (terminalFailure || documentRef.body.dataset.arenaReady === 'true') return;
    message.hidden = false;
    message.textContent = 'ไม่สามารถโหลดระบบแสดงผล 3 มิติได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองใหม่';
  }, delay);

  return {
    ready() {
      window.clearTimeout(timeoutId);
      if (terminalFailure) return;
      documentRef.body.dataset.arenaReady = 'true';
      delete documentRef.body.dataset.arenaFailed;
      message.hidden = true;
      message.textContent = '';
    },

    fail(text) {
      terminalFailure = true;
      window.clearTimeout(timeoutId);
      documentRef.body.dataset.arenaFailed = 'true';
      message.hidden = false;
      message.textContent = text;
    },
  };
}
