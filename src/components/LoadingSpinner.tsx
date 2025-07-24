export default function LoadingSpinner() {
  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
      <div className="bg-black bg-opacity-80 backdrop-blur-sm rounded-xl p-4 flex flex-col items-center space-y-3 border border-gray-600">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent"></div>
        <p className="text-sm font-medium text-white">Processing...</p>
      </div>
    </div>
  );
} 