export interface OfficeRendererEnvironment {
  readonly DEV?: boolean;
  readonly VITE_COWORKANY_VIRTUAL_OFFICE_PIXI?: string;
}

/** Production stays on React until the macOS renderer acceptance gate is met. */
export function officeSceneEnabled(environment: OfficeRendererEnvironment): boolean {
  const flag = environment.VITE_COWORKANY_VIRTUAL_OFFICE_PIXI;
  if (flag === "0") return false;
  return environment.DEV === true || flag === "1";
}
