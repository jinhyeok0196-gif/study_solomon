INSERT INTO student_profiles (id) SELECT u.id FROM users u LEFT JOIN student_profiles sp ON u.id = sp.id WHERE u.role = 'student' AND sp.id IS NULL;
2