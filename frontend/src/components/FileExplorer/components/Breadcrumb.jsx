import React from 'react';

function Breadcrumb({ breadcrumb, onNavigate }) {
  if (!breadcrumb || breadcrumb.length === 0) {
    return <div className="breadcrumb" />;
  }

  return (
    <div className="breadcrumb">
      {breadcrumb.map((crumb, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span className="breadcrumb-sep">›</span>}
          <button
            className="breadcrumb-item"
            onClick={() => onNavigate(crumb.path)}
          >
            {crumb.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export default Breadcrumb;
