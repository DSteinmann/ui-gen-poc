import React, { useState, useEffect } from 'react';

const deviceId = 'device-smartphone-001';
const websocketUrl = `ws://localhost:3001?deviceId=${encodeURIComponent(deviceId)}`;

const SpeakCue = ({ text }) => {
  useEffect(() => {
    if (!text) {
      return;
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }

    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [text]);

  return (
    <div style={{ padding: '8px', margin: '8px 0', background: '#f5f5f5', borderRadius: '6px' }}>
      <strong>Audio prompt:</strong>
      <div>{text}</div>
    </div>
  );
};

function App() {
  const [ui, setUi] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    const ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
      console.log('Connected to UI Generator');
    };

    ws.onmessage = (event) => {
      console.log('Received UI definition:', event.data);
      try {
        const payload = JSON.parse(event.data);
        const messageUi = payload && payload.ui ? payload.ui : payload;
        setUi(messageUi);
        setLastUpdate(payload.generatedAt || new Date().toISOString());
      } catch (error) {
        console.error('Error parsing UI definition:', error);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from UI Generator');
    };

    return () => {
      ws.close();
    };
  }, []);

  const renderUi = (element) => {
    if (!element) {
      return null;
    }

    if (element.props && element.props.children) {
      return renderUi(element.props.children);
    }

    if (Array.isArray(element)) {
      return element.map((child, index) => (
        <React.Fragment key={index}>{renderUi(child)}</React.Fragment>
      ));
    }
    
    if (element.components) {
      return renderUi(element.components);
    }

    const type = element.component || element.type;
    const props = element.props || element;

    if (!type) {
      return null;
    }

    switch (type) {
      case 'container':
        return (
          <div style={{ border: '1px solid black', padding: '10px', margin: '10px' }}>
            {Array.isArray(props.children) && props.children.map((child, index) => (
              <React.Fragment key={index}>{renderUi(child)}</React.Fragment>
            ))}
          </div>
        );
      case 'text':
        return <p>{props.content}</p>;
      case 'button':
        return (
          <button onClick={props.action ? () => alert(JSON.stringify(props.action)) : null}>
            {props.label || props.content}
          </button>
        );
      case 'input':
        return <input type={props.type || 'text'} placeholder={props.placeholder} />;
      case 'toggle':
        return (
          <label>
            <input
              type="checkbox"
              checked={props.checked}
              onChange={props.action ? () => alert(JSON.stringify(props.action)) : null}
            />
            {props.label}
          </label>
        );
      case 'speak':
        return <SpeakCue text={props.text || props.content} />;
      default:
        return null;
    }
  };

  return (
    <div>
      <h1>End Device</h1>
      <div style={{ marginBottom: '12px' }}>Listening for UI updates…</div>
      {lastUpdate && <div style={{ marginBottom: '12px' }}>Last update: {new Date(lastUpdate).toLocaleTimeString()}</div>}
      {renderUi(ui)}
    </div>
  );
}

export default App;