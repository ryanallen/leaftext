import * as React from 'react';
import { createLeaftext } from './api.js';

const LeaftextContext = React.createContext(null);

/** Supply one loaded Leaftext runtime and the active document to a product's React tree. */
export function LeaftextProvider({ children, leaftext = null, module = null, moduleUrl, assetBase }) {
  const [runtime, setRuntime] = React.useState(leaftext);
  const [document_, setDocument] = React.useState(null);
  const [state, setState] = React.useState(null);

  React.useEffect(() => {
    if (leaftext) {
      setRuntime(leaftext);
      return undefined;
    }
    let current = true;
    createLeaftext({ module, moduleUrl, assetBase }).then((loaded) => {
      if (current) setRuntime(loaded);
    });
    return () => {
      current = false;
    };
  }, [leaftext, module, moduleUrl, assetBase]);

  const bind = React.useCallback((next) => {
    setDocument(next);
    setState(next ? next.state : null);
    if (!next) return () => {};
    const unsubscribe = next.subscribe((event) => {
      if (event && event.state) setState(event.state);
    });
    return () => {
      unsubscribe();
      setDocument(null);
      setState(null);
    };
  }, []);
  const value = React.useMemo(() => ({ leaftext: runtime, document: document_, state, bind }), [runtime, document_, state, bind]);
  return React.createElement(LeaftextContext.Provider, { value }, children);
}

/** Read the loaded runtime, mounted document and latest document state. */
export function useLeaftext() {
  const value = React.useContext(LeaftextContext);
  if (!value) throw new Error('useLeaftext must be inside LeaftextProvider');
  return value;
}

function LeaftextDocument({ editable, source, path, save, glossary, onEvent, onReady, className, style }) {
  const { leaftext, bind } = useLeaftext();
  const target = React.useRef(null);
  React.useEffect(() => {
    if (!leaftext || !target.current) return undefined;
    let current = true;
    let document_ = null;
    let unbind = () => {};
    const mount = editable ? leaftext.editor : leaftext.reader;
    mount(target.current, { source, path, save, glossary, onEvent }).then((mounted) => {
      if (!current) {
        mounted.destroy();
        return;
      }
      document_ = mounted;
      unbind = bind(mounted);
      if (typeof onReady === 'function') onReady(mounted);
    });
    return () => {
      current = false;
      unbind();
      if (document_) document_.destroy();
    };
  }, [leaftext, bind, editable, source, path, save, glossary, onEvent, onReady]);
  return React.createElement('div', { ref: target, className, style });
}

export function LeaftextReader(props) {
  return React.createElement(LeaftextDocument, { ...props, editable: false });
}

export function LeaftextEditor(props) {
  return React.createElement(LeaftextDocument, { ...props, editable: true });
}
