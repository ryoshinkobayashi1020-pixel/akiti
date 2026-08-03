export function formatYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`
}

export function formatManYen(value: number): string {
  return `${Math.round(value / 10000).toLocaleString('ja-JP')}万円`
}
