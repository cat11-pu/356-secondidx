// idx.js：二级索引挂链的读取与摘除（不改动入参，全部返回新结构）

// 取某个次键挂着的升序主键链；没有这个次键时给空表。
export function chainOf(aux, sk) {
  for (const row of aux) {
    if (row[0] === sk) return row[1].slice();
  }
  return [];
}

// 从某个次键的挂链里摘掉一个主键；挂链摘空了就把这个次键整条移出。
// 次键本身仍按次键升序摆放。
export function dropOf(aux, sk, pk) {
  const next = [];
  for (const row of aux) {
    if (row[0] !== sk) {
      next.push([row[0], row[1].slice()]);
      continue;
    }
    const chain = row[1].filter(function (id) { return id !== pk; });
    if (chain.length > 0) next.push([row[0], chain]);
  }
  return next;
}
