import { KeyboardShortcut } from "@Core/Components";
import { type SearchResultItemAction } from "@common/Core";
import {
    Button,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    Toast,
    ToastTitle,
    Toaster,
    useId,
    useToastController,
} from "@fluentui/react-components";
import { MoreVerticalFilled } from "@fluentui/react-icons";
import { useEffect, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { FluentIcon } from "../FluentIcon";

type AdditionalActionsProps = {
    actions: SearchResultItemAction[];
    invokeAction: (action: SearchResultItemAction) => void;
    additionalActionsButtonRef: Ref<HTMLButtonElement>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    keyboardShortcut: string;
};

export const ActionsMenu = ({
    actions,
    invokeAction,
    additionalActionsButtonRef,
    open,
    onOpenChange,
    keyboardShortcut,
}: AdditionalActionsProps) => {
    const { t } = useTranslation();

    const toasterId = useId("copiedToClipboardToasterId");
    const { dispatchToast } = useToastController(toasterId);

    useEffect(() => {
        const copiedToClipboardHandler = () =>
            dispatchToast(
                <Toast>
                    <ToastTitle>{t("copiedToClipboard", { ns: "general" })}</ToastTitle>
                </Toast>,
                { intent: "success", position: "bottom" },
            );

        window.ContextBridge.ipcRenderer.on("copiedToClipboard", copiedToClipboardHandler);

        return () => {
            window.ContextBridge.ipcRenderer.off("copiedToClipboard", copiedToClipboardHandler);
        };
    }, []);

    return (
        <>
            <Toaster toasterId={toasterId} />
            <Menu open={open} onOpenChange={(_, { open }) => onOpenChange(open)}>
                <MenuTrigger disableButtonEnhancement>
                    <Button
                        className="non-draggable-area"
                        title={`${t("actions", { ns: "general" })} (${keyboardShortcut})`}
                        size="medium"
                        appearance="subtle"
                        ref={additionalActionsButtonRef}
                        icon={<MoreVerticalFilled fontSize={20} />}
                    >
                        {t("actions", { ns: "general" })}
                    </Button>
                </MenuTrigger>
                <MenuPopover className="non-draggable-area studio-actions-menu">
                    <MenuList>
                        {actions.map((action) => (
                            <MenuItem
                                key={`additional-action-${action.argument}-${action.handlerId}`}
                                onClick={() => {
                                    onOpenChange(false);
                                    invokeAction(action);
                                }}
                                icon={
                                    action.fluentIcon ? (
                                        <FluentIcon fontSize={16} icon={action.fluentIcon} />
                                    ) : undefined
                                }
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 8,
                                        width: "100%",
                                    }}
                                >
                                    <Text weight="medium" size={200} wrap={false}>
                                        {action.descriptionTranslation
                                            ? t(action.descriptionTranslation.key, {
                                                  ns: action.descriptionTranslation.namespace,
                                              })
                                            : action.description}
                                    </Text>
                                    {action.keyboardShortcut && <KeyboardShortcut shortcut={action.keyboardShortcut} />}
                                </div>
                            </MenuItem>
                        ))}
                        {actions.length > 0 && <MenuDivider />}
                        <MenuItem
                            onClick={() => {
                                onOpenChange(false);
                                window.ContextBridge.openSettings();
                            }}
                        >
                            {t("settings", { ns: "general" })}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};
