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
      // Optionally update cart count here
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