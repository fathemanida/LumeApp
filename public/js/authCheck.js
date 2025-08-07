document.addEventListener('DOMContentLoaded', function() {
    checkAuthStatus();
    
    setInterval(checkAuthStatus, 60000);
});

async function checkAuthStatus() {
    try {
        const response = await fetch('/check-auth');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        
        if (data.isBlocked) {
            if (!sessionStorage.getItem('blockNotified')) {
                alert("Your account is blocked by admin.");
                sessionStorage.setItem('blockNotified', 'true');
            }
            window.location.href = "/logout"; 
        } else if (data.isAuthenticated) {
            sessionStorage.removeItem('blockNotified');
        }
    } catch (error) {
        console.error("Error checking auth status:", error);
    }
}
