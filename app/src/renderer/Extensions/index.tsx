import { useExtensionProps } from "@Core/Hooks";
import type { ReactElement } from "react";
import { AiExtension, AiSettings } from "./Ai";
import { ApplicationSearchSettings } from "./ApplicationSearch";
import { Base64Conversion, Base64ConversionSettings } from "./Base64Conversion";
import { BrowserBookmarksSettings } from "./BrowserBookmarks";
import { BuiltInToolSettings, ClipboardHistorySettings, MeowmateSettings } from "./BuiltInToolSettings";
import { CalculatorSettings } from "./Calculator";
import { ColorConverterSettings } from "./ColorConverter";
import { CurrencyConversionSettings } from "./CurrencyConversion";
import { CustomWebSearchSettings } from "./CustomWebSearch";
import { DeeplTranslator, DeeplTranslatorSettings } from "./DeeplTranslator";
import { FileSearch, FileSearchSettings } from "./FileSearch";
import { Notes } from "./Notes";
import { PasswordGeneratorSettings } from "./PasswordGenerator";
import { QuickFormatterSettings } from "./QuickFormatter";
import { RowlandTextEditor, RowlandTextEditorSettings } from "./RowlandTextEditor";
import { SimpleFileSearchSettings } from "./SimpleFileSearch";
import { TerminalLauncherSettings } from "./TerminalLauncher";
import { UuidGenerator, UuidGeneratorSettings } from "./UuidGenerator";
import { VSCodeSettings } from "./VSCode";
import { WebSearchExtension } from "./WebSearch";
import { WebSearchSettings } from "./WebSearch/WebSearchSettings";
import { Whiteboard } from "./Whiteboard";
import { WorkflowSettings } from "./Workflow";

type ExtensionReactElements = {
    extension?: ReactElement;
    settings?: ReactElement;
};

export const getExtension = (extensionId: string): ExtensionReactElements | undefined => {
    const props = useExtensionProps();

    /**
     * Add your extension to this list. Make sure that the items in this list are alphabetically ordered.
     */
    /*eslint sort-keys: "error"*/
    const extensions: Record<string, ExtensionReactElements> = {
        Ai: {
            extension: <AiExtension {...props} />,
            settings: <AiSettings />,
        },
        ApplicationSearch: {
            settings: <ApplicationSearchSettings />,
        },
        Base64Conversion: {
            extension: <Base64Conversion {...props} />,
            settings: <Base64ConversionSettings />,
        },
        BrowserBookmarks: {
            settings: <BrowserBookmarksSettings />,
        },
        Calculator: {
            settings: <CalculatorSettings />,
        },
        ClipboardHistory: {
            settings: <ClipboardHistorySettings />,
        },
        ColorConverter: {
            settings: <ColorConverterSettings />,
        },
        CurrencyConversion: {
            settings: <CurrencyConversionSettings />,
        },
        CustomWebSearch: {
            settings: <CustomWebSearchSettings />,
        },
        DeeplTranslator: {
            extension: <DeeplTranslator {...props} />,
            settings: <DeeplTranslatorSettings />,
        },
        EmojiPicker: { settings: <BuiltInToolSettings extensionId="EmojiPicker" /> },
        FileSearch: {
            extension: <FileSearch {...props} />,
            settings: <FileSearchSettings />,
        },
        Meowmate: { settings: <MeowmateSettings /> },
        Notes: { extension: <Notes {...props} />, settings: <BuiltInToolSettings extensionId="Notes" /> },
        PasswordGenerator: {
            settings: <PasswordGeneratorSettings />,
        },
        QuickFormatter: {
            settings: <QuickFormatterSettings />,
        },
        RowlandTextEditor: {
            extension: <RowlandTextEditor {...props} />,
            settings: <RowlandTextEditorSettings />,
        },
        SimpleFileSearch: {
            settings: <SimpleFileSearchSettings />,
        },
        TerminalLauncher: {
            settings: <TerminalLauncherSettings />,
        },
        UeliCommand: { settings: <BuiltInToolSettings extensionId="UeliCommand" /> },
        UuidGenerator: {
            extension: <UuidGenerator {...props} />,
            settings: <UuidGeneratorSettings />,
        },
        VSCode: {
            settings: <VSCodeSettings />,
        },
        WebSearch: {
            extension: <WebSearchExtension {...props} />,
            settings: <WebSearchSettings />,
        },
        Whiteboard: {
            extension: <Whiteboard {...props} />,
            settings: <BuiltInToolSettings extensionId="Whiteboard" />,
        },
        Workflow: {
            settings: <WorkflowSettings />,
        },
    };

    return extensions[extensionId];
};
