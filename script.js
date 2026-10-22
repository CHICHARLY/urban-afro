document.getElementById("year").textContent = new Date().getFullYear();

const buttons = document.querySelectorAll(".btn");
buttons.forEach((button) => {
  button.addEventListener("mouseenter", () => {
    button.style.transform = "translateY(-1px)";
  });

  button.addEventListener("mouseleave", () => {
    button.style.transform = "translateY(0)";
  });
});

const navLinks = document.querySelectorAll(".nav-menu a");
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
