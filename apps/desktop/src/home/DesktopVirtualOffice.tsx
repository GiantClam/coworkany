import type { OfficeCapabilities, NavigationAdapter } from "../virtual-office/types";
import type { OfficeComposition } from "../virtual-office/office-composition";
import { DesktopHome } from "./DesktopHome";

export interface DesktopVirtualOfficeProps {
  readonly composition: OfficeComposition;
  readonly capabilities: OfficeCapabilities;
  readonly navigation: NavigationAdapter;
  readonly locale: "zh" | "en";
}

export function DesktopVirtualOffice({ composition, capabilities, navigation, locale }: DesktopVirtualOfficeProps) {
  return <DesktopHome composition={composition} capabilities={capabilities} navigation={navigation} locale={locale} showVirtualOffice />;
}
