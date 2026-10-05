/** This is the only import surface a browser plugin may share with its host. */
export const uiExports = ["Alert", "Badge", "Button", "Checkbox", "Dialog", "EmptyState", "Field", "IconButton", "Input", "Loading", "Menu", "MenuItem", "ModelSelect", "Page", "PageHeader", "Panel", "PanelContent", "PanelFooter", "PanelHeader", "Popover", "Select", "Switch", "Textarea", "Tooltip", "UIProvider"] as const;
export const sharedModules = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "@semicoder/malatang-sdk/ui"] as const;
