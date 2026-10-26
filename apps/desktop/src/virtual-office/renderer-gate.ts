export interface OfficeRendererEnvironment {
  readonly DEV?: boolean;
  readonly VITE_COWORKANY_VIRTUAL_OFFICE_PIXI?: string;
}

/**
 * The Pixi scene is the production virtual-office surface now that the
 * bundled asset and renderer acceptance checks are in place. Keep an
 * explicit zero flag as the emergency fallback for constrained environments.
 */
export function officeSceneEnabled(environment: OfficeRendererEnvironment): boolean {
  const flag = environment.VITE_COWORKANY_VIRTUAL_OFFICE_PIXI;
  if (flag === undefined) return true;
  return flag === "1";
}
