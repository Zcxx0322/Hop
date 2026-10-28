/**
 * 背景滚动锁：对话框、命令面板可能同时打开（例如在设置面板上再弹确认框），
 * 用引用计数保证只有最后一个关闭者才恢复 body 的滚动，避免“关掉上层、底层锁被解开”。
 */
let count = 0;
let previousOverflow = '';

export function lockBodyScroll(): () => void {
  if (count === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  count += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) document.body.style.overflow = previousOverflow;
  };
}
