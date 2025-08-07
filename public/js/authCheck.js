document.addEventListener('DOMContentLoaded', function() {
    checkAuthStatus();
    console.log('===function called');
    setInterval(checkAuthStatus, 3000);
});

async function checkAuthStatus() {
    try {
        const response = await fetch('/check-auth');
        console.log('===it is working everry 3 secs');
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
