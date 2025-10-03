import React, { useState, useEffect, useCallback, useRef } from 'react';

const WiggleButton = ({ label, action }) => {
  const [isWiggling, setIsWiggling] = useState(false);
  const lastMousePosition = useRef({ x: 0, y: 0, time: 0 });
  const timeoutRef = useRef(null);

  const handleMouseMove = (event) => {
    const { clientX, clientY } = event;
    const now = Date.now();
    const distance = Math.sqrt(Math.pow(clientX - lastMousePosition.current.x, 2) + Math.pow(clientY - lastMousePosition.current.y, 2));
    const timeElapsed = now - lastMousePosition.current.time;

    if (timeElapsed > 0) {
      const speed = distance / timeElapsed;
      if (speed > 5) { // Threshold for wiggle detection
        setIsWiggling(true);
        if (action) {
          action();
        }
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => setIsWiggling(false), 500);
      }
    }

    lastMousePosition.current = { x: clientX, y: clientY, time: now };
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        padding: '20px',
        border: '2px dashed #ccc',
        borderRadius: '10px',
        textAlign: 'center',
        backgroundColor: isWiggling ? '#e0e0e0' : 'transparent',
        transition: 'background-color 0.3s',
        cursor: 'pointer'
      }}
    >
      {label}
    </div>
  );
};


function App() {
  const [ui, setUi] = useState(null);
  const [thingDescription, setThingDescription] = useState(null);
  const [schema, setSchema] = useState(null);
  const availableCapabilities = ['text', 'input', 'container', 'wiggle']; // All possible UI components
  const [selectedCapabilities, setSelectedCapabilities] = useState(availableCapabilities); // Currently selected capabilities

  const fetchThingDescription = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3002/thing-description');
      const td = await response.json();
      setThingDescription(td);
      console.log('Fetched Thing Description:', td);
    } catch (error) {
      console.error('Error fetching Thing Description:', error);
    }
  }, []);

  const sendPrompt = useCallback(async (currentPrompt) => {
    if (!thingDescription || !schema) return; // Ensure thingDescription and schema are loaded
    try {
      const response = await fetch('http://localhost:3001/generate-ui', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: currentPrompt, thingDescription, capabilities: selectedCapabilities, schema }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Error response from UI Generator:', data);
        throw new Error(data.details || 'Unknown error from UI Generator');
      }

      console.log(data);
    } catch (error) {
      console.error('Error sending prompt:', error);
    }
  }, [thingDescription, selectedCapabilities, schema]);

  useEffect(() => {
    fetchThingDescription();

    const fetchSchema = async () => {
      try {
        const response = await fetch('/schema.json');
        const schemaData = await response.json();
        setSchema(schemaData);
        console.log('Fetched Schema:', schemaData);
      } catch (error) {
        console.error('Error fetching schema:', error);
      }
    };
    fetchSchema();

    const ws = new WebSocket('ws://localhost:3001');

    ws.onopen = () => {
      console.log('Connected to UI Generator');
    };

    ws.onmessage = (event) => {
      console.log('Received UI definition:', event.data);
      try {
        const uiDefinition = JSON.parse(event.data);
        setUi(uiDefinition);
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
  }, [fetchThingDescription]);

  useEffect(() => {
    if (thingDescription && schema) {
      sendPrompt('a passive UI with a wiggle button');
    }
  }, [thingDescription, selectedCapabilities, sendPrompt, schema]);

  const handleCapabilityChange = (capability) => {
    setSelectedCapabilities(prevCapabilities =>
      prevCapabilities.includes(capability)
        ? prevCapabilities.filter(c => c !== capability)
        : [...prevCapabilities, capability]
    );
  };

  const handleAction = async (action) => {
    if (action.type === 'http') {
      try {
        await fetch(action.url, {
          method: action.method,
        });
        // After performing the action, refresh the Thing Description to get the new state
        await fetchThingDescription();
      } catch (error) {
        console.error('Error performing action:', error);
      }
    }
  };

  const renderUi = (element) => {
    console.log('Rendering UI:', element);
    if (!element) {
      return null;
    }

    let type;
    let props;

    if (element.type) {
      type = element.type;
      props = element;
    } else {
      type = Object.keys(element)[0];
      props = element[type];
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
      case 'input':
        return <input type={props.type || 'text'} placeholder={props.placeholder} />;
      case 'wiggle':
        return <WiggleButton label={props.label} action={props.action ? () => handleAction(props.action) : null} />;
      default:
        return null;
    }
  };

  return (
    <div>
      <h1>Passive End Device</h1>
      <div style={{ marginBottom: '20px' }}>
        <h2>Capabilities:</h2>
        {availableCapabilities.map(capability => (
          <label key={capability} style={{ marginRight: '10px' }}>
            <input
              type="checkbox"
              checked={selectedCapabilities.includes(capability)}
              onChange={() => handleCapabilityChange(capability)}
            />
            {capability}
          </label>
        ))}
      </div>
      {renderUi(ui)}
    </div>
  );
}

export default App;
