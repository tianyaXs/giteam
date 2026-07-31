import { useEffect, useRef, useState } from "react";
import { getCustomMcpParamSpecs, inferCustomMcpName } from "./opencodeMcpConfig";

export type OpencodeMcpType = "local" | "remote";

export function useOpencodeMcpAddForm(isOpen: boolean) {
  const [name, setName] = useState("");
  const [type, setType] = useState<OpencodeMcpType>("remote");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [json, setJson] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const autoNameRef = useRef("");

  useEffect(() => {
    if (!isOpen) return;
    const inferred = inferCustomMcpName(json);
    if (!inferred) return;
    const current = name.trim();
    if (current && current !== autoNameRef.current) return;
    autoNameRef.current = inferred;
    setName(inferred);
  }, [isOpen, json, name]);

  useEffect(() => {
    if (!isOpen) return;
    const specs = getCustomMcpParamSpecs(json, name);
    setParamValues((prev) => {
      const next: Record<string, string> = {};
      specs.forEach((spec) => {
        next[spec.key] = prev[spec.key] || "";
      });
      return next;
    });
  }, [isOpen, json, name]);

  const setParamValue = (key: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [key]: value }));
  };

  const reset = () => {
    setName("");
    setType("remote");
    setCommand("");
    setUrl("");
    setEnv("");
    setHeaders("");
    setJson("");
    setParamValues({});
    autoNameRef.current = "";
  };

  return {
    name,
    setName,
    type,
    setType,
    command,
    setCommand,
    url,
    setUrl,
    env,
    setEnv,
    headers,
    setHeaders,
    json,
    setJson,
    paramValues,
    setParamValue,
    reset
  };
}
