export function formatMileage(mileage: number): string {
  return `K${Math.floor(mileage / 1000)}+${String(Math.round(mileage % 1000)).padStart(3, '0')}`
}
