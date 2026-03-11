import React from 'react';
import './versioning.css';

const RiskBadge = ({ level }) => {
  const getBadgeClass = () => {
    switch (level?.toLowerCase()) {
      case 'high':
        return 'badge-high';
      case 'medium':
        return 'badge-medium';
      case 'low':
        return 'badge-low';
      default:
        return 'badge-unknown';
    }
  };

  return (
    <span className={`risk-badge ${getBadgeClass()}`}>
      {level || 'Unknown'} Risk
    </span>
  );
};

export default RiskBadge;
