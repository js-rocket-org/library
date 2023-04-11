const jwt = ''
const jwtParts = jwt.split('.')
console.log( atob(jwtParts[0]) );
console.log( atob(jwtParts[1]) );
