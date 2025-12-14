import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  active?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  active = false,
  className = '', 
  ...props 
}) => {
  const baseStyle = "transition-all duration-200 ease-out rounded-lg font-medium flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-claude-accent text-white hover:bg-[#C06040] shadow-sm hover:shadow active:scale-95 px-4 py-2",
    secondary: "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm px-3 py-1.5 text-sm",
    ghost: `hover:bg-black/5 text-gray-600 px-3 py-1.5 ${active ? 'bg-black/5 text-claude-accent font-semibold' : ''}`,
    icon: "p-2 text-gray-400 hover:text-gray-600 hover:bg-black/5 rounded-lg transition-colors"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};