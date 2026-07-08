const fs = require('fs');
let code = fs.readFileSync('renderer.js', 'utf8');

const targetBlock = `
                dd.querySelectorAll('.custom-dropdown-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                if (currentIcon && option.querySelector('img')) currentIcon.src = option.querySelector('img').src;
                if (currentText && option.querySelector('span')) currentText.textContent = option.querySelector('span').textContent;
`;

if (code.includes(targetBlock)) {
    code = code.replace(targetBlock, `
                dd.value = val;
`);
    fs.writeFileSync('renderer.js', code);
    console.log('Fixed dd.value');
} else {
    console.error('Target block not found');
}
