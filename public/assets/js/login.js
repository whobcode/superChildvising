document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('.form-signin');
    const errorMessage = document.getElementById('error-message');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('token', data.token);
            window.location.href = 'panel.html';
        } else {
            errorMessage.textContent = 'Invalid username or password';
        }
    });
});
