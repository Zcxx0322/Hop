/**
 * 浮层栈：对话框和命令面板都会注册自己，只有最后打开的那一层响应 Esc / Tab。
 * 否则在「新建连接表单」上再打开命令面板时，一次 Esc 会把两层一起关掉。
 */
const stack: string[] = [];

export function pushOverlay(id: string): () => void {
  stack.push(id);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = stack.lastIndexOf(id);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function isTopOverlay(id: string): boolean {
  return stack[stack.length - 1] === id;
}
