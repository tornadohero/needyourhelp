/**
 * City codes as a person reads them.
 *
 * `GET /providers` returns the taxonomy code (`BEIJING`), which is what the
 * server filters on; a screen shows the Chinese name. The table mirrors the
 * CITY terms the platform seeds — a code that is not listed yet still shows as
 * itself, so an unknown city is never silently hidden or replaced with a guess.
 */
export interface CityOption {
  code: string;
  name: string;
}

export const CITY_OPTIONS: readonly CityOption[] = [
  { code: '', name: '不限城市' },
  { code: 'BEIJING', name: '北京' },
  { code: 'SHANGHAI', name: '上海' },
  { code: 'GUANGZHOU', name: '广州' },
  { code: 'SHENZHEN', name: '深圳' },
  { code: 'HANGZHOU', name: '杭州' },
];

/** Chinese label for a city code; `未标注城市` when the profile has none. */
export function cityName(code: string | null): string {
  if (code === null || code.trim().length === 0) {
    return '未标注城市';
  }
  const found = CITY_OPTIONS.find((option) => option.code === code.trim().toUpperCase());
  return found?.name ?? code;
}

/** Options for a `<picker>`: the labels it shows. */
export function cityLabels(): string[] {
  return CITY_OPTIONS.map((option) => option.name);
}

/** The code behind the label a picker selected. */
export function cityCodeAt(index: number): string {
  return CITY_OPTIONS[index]?.code ?? '';
}

/** Where a given code sits in the picker, so the sheet can preselect it. */
export function cityIndexOf(code: string): number {
  const found = CITY_OPTIONS.findIndex((option) => option.code === code.trim().toUpperCase());
  return found < 0 ? 0 : found;
}
