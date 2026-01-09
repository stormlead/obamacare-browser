const express = require('express');
const path = require('path');
const plansRoutes = require('./routes/plans');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use('/', plansRoutes);
app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  const message = process.env.NODE_ENV === 'production'
    ? 'Something went wrong!'
    : err.message || 'Something went wrong!';
  res.status(500).render('error', { message });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
