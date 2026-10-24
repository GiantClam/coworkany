import { useEffect, type ReactNode } from "react";
import type { OfficeCapabilities, NavigationAdapter } from "../virtual-office/types";
import type { OfficeComposition } from "../virtual-office/office-composition";
import { VirtualOfficeHome } from "../virtual-office/VirtualOfficeHome";

export interface DesktopHomeProps {
  readonly composition: OfficeComposition;
  readonly capabilities: OfficeCapabilities;
  readonly navigation: NavigationAdapter;
  readonly locale: "zh" | "en";
  readonly children?: ReactNode;
  readonly showVirtualOffice?: boolean;
}

export function DesktopHome({ composition, capabilities, navigation, locale, children, showVirtualOffice = false }: DesktopHomeProps) {
  useEffect(() => {
    if (!showVirtualOffice) return;
    let active = true;
    void composition.start();
    return () => {
      if (active) composition.stop();
      active = false;
    };
  }, [composition, showVirtualOffice]);
  return <div className={`desktop-home${showVirtualOffice ? " desktop-home--virtual-office" : ""}`.trim()}>{showVirtualOffice ? <VirtualOfficeHome store={composition.store} capabilities={capabilities} navigation={navigation} locale={locale} standalone /> : null}{children}</div>;
}
