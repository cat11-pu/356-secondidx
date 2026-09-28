// idx.js：挂链读取与摘除（不改传入的二级索引，一律返回新表）
export function chainOf(aux, sk) {
  for (const row of aux || []) {
    if (row[0] === sk) return row[1].slice();
  }
  return [];
}

export function dropOf(aux, sk, pk) {
  const next = [];
  for (const row of aux || []) {
    if (row[0] === sk) {
      const chain = row[1].filter(function (cell) { return cell !== pk; });
      if (chain.length > 0) next.push([row[0], chain]);
    } else {
      next.push([row[0], row[1].slice()]);
    }
  }
  return next;
}
