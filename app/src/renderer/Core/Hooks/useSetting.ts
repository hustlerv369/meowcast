import type { IpcRendererEvent } from "electron";
import { useEffect, useRef, useState } from "react";

export const useSetting = <Value>({
    key,
    defaultValue,
    isSensitive,
}: {
    key: string;
    defaultValue: Value;
    isSensitive?: boolean;
}) => {
    const [value, setValue] = useState<Value>(window.ContextBridge.getSettingValue(key, defaultValue, isSensitive));
    const confirmedValue = useRef(value);
    const revision = useRef(0);

    const updateValue = async (updatedValue: Value) => {
        const updateRevision = ++revision.current;
        setValue(updatedValue);

        try {
            await window.ContextBridge.updateSettingValue(key, updatedValue, isSensitive);

            if (revision.current === updateRevision) {
                confirmedValue.current = updatedValue;
            }
        } catch (error) {
            if (revision.current === updateRevision) {
                setValue(confirmedValue.current);
            }

            throw error;
        }
    };

    useEffect(() => {
        const listener = (_: IpcRendererEvent, { value: newValue }: { value: Value }) => {
            ++revision.current;
            confirmedValue.current = newValue;
            setValue(newValue);
        };

        window.ContextBridge.ipcRenderer.on(`settingUpdated[${key}]`, listener);

        return () => {
            window.ContextBridge.ipcRenderer.off(`settingUpdated[${key}]`, listener);
        };
    }, []);

    return { value, updateValue };
};
