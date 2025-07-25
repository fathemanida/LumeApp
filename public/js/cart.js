// Add to Cart function for product listing/detail pages
window.addToCart = async function(productId, productName, regularPrice, salePrice, productImage) {
  try {
    const res = await fetch('/cart/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId, quantity: 1 })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      Toastify({
        text: `${productName} added to cart!`,
        duration: 2000,
        gravity: 'top',
        position: 'center',
        backgroundColor: '#A9BA9D',
        stopOnFocus: true
      }).showToast();
      // Update cart count and refresh cart display if on cart page
      updateCartCount();
      if (window.location.pathname === '/cart') {
        location.reload();
      }
    } else {
      Toastify({
        text: data.message || 'Could not add to cart',
        duration: 2000,
        gravity: 'top',
        position: 'center',
        backgroundColor: '#e63946',
        stopOnFocus: true
      }).showToast();
    }
  } catch (err) {
    Toastify({
      text: 'Error adding to cart',
      duration: 2000,
      gravity: 'top',
      position: 'center',
      backgroundColor: '#e63946',
      stopOnFocus: true
    }).showToast();
  }
};

// Update cart quantity
window.updateQuantity = async function(itemId, action) {
  try {
    const response = await fetch('/cart/update-quantity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ itemId, action })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Reload the page to reflect updated quantities and recalculated offers
      location.reload();
    } else {
      showNotification(data.message || 'Failed to update quantity', 'error');
    }
  } catch (error) {
    console.error('Error updating quantity:', error);
    showNotification('Error updating quantity', 'error');
  }
};

// Remove item from cart
window.removeItem = async function(itemId) {
  try {
    const response = await fetch('/cart/remove-item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ itemId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Item removed from cart', 'success');
      // Reload the page to reflect changes
      location.reload();
    } else {
      showNotification(data.message || 'Failed to remove item', 'error');
    }
  } catch (error) {
    console.error('Error removing item:', error);
    showNotification('Error removing item', 'error');
  }
};

// Apply coupon
window.applyCoupon = async function(code) {
  try {
    const response = await fetch('/cart/apply-coupon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Coupon applied successfully!', 'success');
      // Reload to show updated prices with coupon
      location.reload();
    } else {
      showNotification(data.message || 'Failed to apply coupon', 'error');
    }
  } catch (error) {
    console.error('Error applying coupon:', error);
    showNotification('Error applying coupon', 'error');
  }
};

// Remove coupon
window.removeCoupon = async function() {
  try {
    const response = await fetch('/cart/remove-coupon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Coupon removed successfully', 'success');
      // Reload to show updated prices without coupon
      location.reload();
    } else {
      showNotification(data.message || 'Failed to remove coupon', 'error');
    }
  } catch (error) {
    console.error('Error removing coupon:', error);
    showNotification('Error removing coupon', 'error');
  }
};

// Update cart count in header
function updateCartCount() {
  fetch('/cart/count')
    .then(response => response.json())
    .then(data => {
      const cartCountElement = document.querySelector('.cart-count');
      if (cartCountElement && data.success) {
        cartCountElement.textContent = data.count;
      }
    })
    .catch(error => console.error('Error updating cart count:', error));
}

// Show notification
function showNotification(message, type) {
  Toastify({
    text: message,
    duration: 3000,
    gravity: "top",
    position: "right",
    backgroundColor: type === 'success' ? '#4a6741' : '#e63946',
    stopOnFocus: true,
    style: {
      fontFamily: "'Jost', sans-serif",
      fontSize: "14px",
      padding: "12px 20px",
      borderRadius: "8px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
    }
  }).showToast();
}

// Initialize cart functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Update cart count on page load
  updateCartCount();
  
  // Display offer information for cart items
  displayOfferInfo();
});

// Display offer information for cart items
function displayOfferInfo() {
  const cartItems = document.querySelectorAll('.cart-item');
  
  cartItems.forEach(item => {
    const discountBadge = item.querySelector('.discount-badge');
    if (discountBadge && discountBadge.innerHTML.trim()) {
      // Show offer badges if they exist
      discountBadge.style.display = 'block';
      
      // Add styling for better visibility
      const badges = discountBadge.querySelectorAll('.badge');
      badges.forEach(badge => {
        if (badge.textContent.includes('All Products') || badge.textContent.includes('Category Offer') || badge.textContent.includes('Product Offer')) {
          badge.style.marginBottom = '5px';
          badge.style.fontSize = '0.85rem';
          badge.style.fontWeight = '500';
        }
      });
    }
  });
}

// Add this CSS for cart product images
const style = document.createElement('style');
style.innerHTML = `
  .cart-product-image {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: 8px;
    display: block;
  }
  @media (max-width: 600px) {
    .cart-product-image {
      width: 48px;
      height: 48px;
      min-width: 48px;
      min-height: 48px;
      max-width: 48px;
      max-height: 48px;
    }
  }
`;
document.head.appendChild(style); 