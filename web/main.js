import { app } from "../../scripts/app.js";
import { createBrowserEntry } from "./modules/browser_entry.js";
import { createInterfaceSettings, getCurrentLanguage, setAbyssalScarletTheme, t } from "./modules/interface_settings.js";

export { setAbyssalScarletTheme };

const browserEntry = createBrowserEntry({ translate: t, getCurrentLanguage });

app.registerExtension({
    name: "Anomalous.ModelBrowser",
    settings: [...browserEntry.settings, ...createInterfaceSettings()],
    actionBarButtons: browserEntry.actionBarButtons,
    commands: browserEntry.commands,
    keybindings: browserEntry.keybindings,
    menuCommands: browserEntry.menuCommands,
    getNodeMenuItems: browserEntry.getNodeMenuItems,
    setup: browserEntry.setup
});
