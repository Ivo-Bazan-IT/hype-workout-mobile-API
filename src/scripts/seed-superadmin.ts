import bcrypt from 'bcrypt';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { UserModel } from '../infrastructure/database/mongoose/schemas/UserSchema';

const seedSuperadmin = async (): Promise<void> => {
  try {
    // Conectar a la base de datos
    await connectDatabase();

    const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME } = env;

    // Validar que estén configuradas las credenciales
    if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
      console.warn('⚠️  SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD not configured in .env');
      console.warn('   Skipping superadmin seed. Add these variables to create one:');
      console.warn('   SUPERADMIN_EMAIL=superadmin@gymcrm.com');
      console.warn('   SUPERADMIN_PASSWORD=your_secure_password');
      await disconnectDatabase();
      return;
    }

    // Verificar si ya existe
    const existingAdmin = await UserModel.findOne({
      email: SUPERADMIN_EMAIL.toLowerCase()
    });

    if (existingAdmin) {
      console.log(`ℹ️  Superadmin already exists with email: ${SUPERADMIN_EMAIL}`);
      await disconnectDatabase();
      return;
    }

    // Hash del password
    const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 12);

    // Crear superadmin
    const superadmin = await UserModel.create({
      email: SUPERADMIN_EMAIL.toLowerCase(),
      passwordHash,
      role: 'admin',
      name: SUPERADMIN_NAME,
      isActive: true
    });

    console.log(`✅ Superadmin created successfully:`);
    console.log(`   Email: ${superadmin.email}`);
    console.log(`   ID: ${superadmin._id}`);

    await disconnectDatabase();
  } catch (error) {
    console.error('❌ Failed to seed superadmin:', error);
    process.exit(1);
  }
};

seedSuperadmin();